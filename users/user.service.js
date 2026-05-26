// @ts-check
import { z } from 'zod';
import QueryBuilder from '../helpers/queryBuilder.js';
import log from '../helpers/log.js';
import notificationTypes from '../notifications/notification.types.js';

/**
 * Users Table Name
 * @type {string}
 */
const messageCollectionId = 'Messages';
const userCollectionId = 'Users';

/**
 * Schema for Bungie OAuth tokens.
 * @private
 */
const bungieTokenSchema = z.object({
    access_token: z.string(),
    expires_in: z.number(),
    membership_id: z.string(),
    refresh_token: z.string(),
});

/**
 * Schema for a persisted Bungie token on a user document. Less strict than
 * bungieTokenSchema because legacy documents may only carry access_token.
 * @private
 */
const storedBungieTokenSchema = bungieTokenSchema.partial().required({
    access_token: true,
});

/**
 * Schema for anonymous users.
 * @private
 */
const anonymousUserSchema = z.object({
    displayName: z.string().min(3).max(16),
    membershipId: z.string(),
    membershipType: z.number().int().min(1).max(2),
    profilePicturePath: z.string(),
});

/**
 * Schema for user notifications.
 * @private
 */
const notificationSchema = z
    .object({
        enabled: z.boolean(),
        type: z.string(),
        messages: z.array(z.string()).default([]),
    })
    .strict();

/**
 * Schema for registered users.
 * @private
 */
const userSchema = z.object({
    carrier: z.string().optional(),
    dateRegistered: z
        .string()
        .refine(
            val => {
                try {
                    Temporal.Instant.from(val);
                    return true;
                } catch {
                    return false;
                }
            },
            {
                message: 'Invalid date-time format',
            },
        )
        .optional(),
    emailAddress: z.string().email(),
    firstName: z.string(),
    displayName: z.string(),
    isSubscribed: z.boolean().default(true),
    membershipId: z.string(),
    membershipType: z.number().int(),
    lastName: z.string(),
    notifications: z.array(notificationSchema).default([]),
    patches: z.array(z.object({})).default([]),
    phoneNumber: z.string(),
    roles: z.array(z.string()).default(['User']),
    type: z.string().optional(),
    bungie: storedBungieTokenSchema.optional(),
});

/**
 * An anonymous user as validated by `anonymousUserSchema`.
 * @typedef {ReturnType<typeof anonymousUserSchema.parse>} AnonymousUser
 */

/**
 * A user notification as validated by `notificationSchema`.
 * @typedef {ReturnType<typeof notificationSchema.parse>} UserNotification
 */

/**
 * A registered user as validated by `userSchema`.
 * @typedef {ReturnType<typeof userSchema.parse>} User
 */

/**
 * Bungie OAuth token stored on a user record.
 * @typedef {ReturnType<typeof bungieTokenSchema.parse>} BungieToken
 */

/**
 * A stored message document from Cosmos DB.
 * @typedef {Object} UserMessage
 * @property {string} id - Cosmos DB document ID
 * @property {string} SmsSid - Twilio message SID
 * @property {string} SmsStatus - Delivery status ('queued' | 'sent' | 'delivered' | 'failed')
 * @property {string} To - Recipient phone number in E.164 format
 */

/**
 * Carrier lookup result from Twilio.
 * @typedef {Object} CarrierInfo
 * @property {string} name - Carrier name (e.g., 'T-Mobile')
 * @property {string} type - Number type ('mobile' | 'landline' | 'voip')
 */

/**
 * Minimal user projection returned by `getSubscribedUsers`.
 * @typedef {Object} SubscribedUser
 * @property {string} displayName
 * @property {string} membershipId
 * @property {number} membershipType
 * @property {string} phoneNumber
 */

/**
 * Minimal Twilio client interface for carrier lookup.
 * @typedef {Object} TwilioClient
 * @property {(phoneNumber: string) => { get: (options: { countryCode: string, type: string }, callback: (err: unknown, number: { carrier: CarrierInfo }) => void) => void }} phoneNumbers
 */

/**
 * Constructor options for UserService.
 * @typedef {Object} UserServiceOptions
 * @property {import('./user.cache.js').default} cacheService - Redis-backed cache service
 * @property {TwilioClient} client - Twilio client instance
 * @property {import('../helpers/documents.js').default} documentService - Cosmos DB document service
 */

/**
 * User Service Class
 */
class UserService {
    /**
     * @param {UserServiceOptions} options
     */
    constructor(options) {
        const schema = z.object({
            cacheService: z.object({}),
            client: z.object({}),
            documentService: z.object({}),
        });

        schema.parse(options);

        this.cacheService = options.cacheService;
        this.client = options.client;
        this.documents = options.documentService;
    }

    /**
     * Add a message to the user's notification history.
     * @param {Omit<UserMessage, 'id'>} message
     * @returns {Promise<import('../helpers/documents.js').CosmosDocument<Omit<UserMessage, 'id'>> | undefined>}
     */
    async addUserMessage(message) {
        return await this.documents.createDocument(messageCollectionId, {
            DateTime: Temporal.Now.instant().toString({ smallestUnit: 'millisecond' }),
            ...message,
        });
    }

    /**
     * Create an anonymous user.
     * @param {AnonymousUser} user
     * @returns {Promise<import('../helpers/documents.js').CosmosDocument<AnonymousUser> | undefined>}
     */
    async createAnonymousUser(user) {
        try {
            anonymousUserSchema.parse(user);
        } catch (err) {
            if (err instanceof z.ZodError) {
                return Promise.reject(Error(JSON.stringify(err.issues)));
            }
            return Promise.reject(err);
        }

        const existingUser = await this.getUserByDisplayName(
            user.displayName,
            user.membershipType,
            true,
        );

        if (existingUser) {
            if (existingUser.dateRegistered) {
                return Promise.reject(new Error('User is already registered.'));
            }

            return Promise.reject(new Error('Anonymous user already signed in.'));
        }

        return await this.documents.createDocument(userCollectionId, user);
    }

    /**
     * Create a registered user, merging with an existing anonymous record if present.
     * @param {User} user
     * @returns {Promise<import('../helpers/documents.js').CosmosDocument<User> | undefined>}
     */
    async createUser(user) {
        /** @type {import('zod').ZodIssue[]} */
        let issues = [];

        try {
            userSchema.parse(user);
        } catch (err) {
            if (err instanceof z.ZodError) {
                issues = [...issues, ...err.issues];
            } else {
                return Promise.reject(err);
            }
        }

        user.notifications?.forEach(notification => {
            try {
                notificationSchema.parse(notification);
            } catch (err) {
                if (err instanceof z.ZodError) {
                    issues = [...issues, ...err.issues];
                } else {
                    throw err;
                }
            }
        });

        if (issues.length) {
            return Promise.reject(new Error(JSON.stringify(issues)));
        }

        let existingUser = await this.getUserByPhoneNumber(user.phoneNumber);
        if (existingUser) {
            return Promise.reject(
                new Error(`The phone number, ${user.phoneNumber}, is already registered.`),
            );
        }

        existingUser = await this.getUserByEmailAddress(user.emailAddress);
        if (existingUser) {
            return Promise.reject(
                new Error(`The email address, ${user.emailAddress}, is already registered.`),
            );
        }

        existingUser = await this.getUserByDisplayName(user.displayName, user.membershipType, true);

        const carrier = await this.getPhoneNumberType(user.phoneNumber);

        user.carrier = carrier.name;
        user.type = carrier.type;

        if (existingUser) {
            // User exists (from prior sign-in), merge and update
            existingUser = { ...existingUser, ...user };
            return await this.documents.updateDocument(
                userCollectionId,
                existingUser,
                user.membershipType,
            );
        }

        // Anonymous user record missing, create on the fly
        return await this.documents.createDocument(userCollectionId, user);
    }

    /**
     * Delete a message.
     * @param {string} messageId
     * @param {string} phoneNumber
     * @returns {Promise<import('@azure/cosmos').ItemResponse<Record<string, unknown>>>}
     */
    async #deleteMessage(messageId, phoneNumber) {
        return await this.documents.deleteDocumentById(messageCollectionId, messageId, phoneNumber);
    }

    /**
     * Delete a user.
     * @param {string} documentId
     * @param {number} membershipType
     * @returns {Promise<import('@azure/cosmos').ItemResponse<Record<string, unknown>>>}
     */
    // biome-ignore lint/correctness/noUnusedPrivateClassMembers: future use
    async #deleteUser(documentId, membershipType) {
        return await this.documents.deleteDocumentById(
            userCollectionId,
            documentId,
            membershipType,
        );
    }

    /**
     * Delete messages with the status 'queued' or 'sent' given the message was 'delivered'.
     * @param {string} phoneNumber
     * @returns {Promise<void>}
     */
    async deleteUserMessages(phoneNumber) {
        const messages = await this.documents.getDocuments(
            messageCollectionId,
            {
                query: "SELECT * FROM c WHERE c.SmsStatus != 'delivered' AND c.To = @phoneNumber",
                parameters: [{ name: '@phoneNumber', value: phoneNumber }],
            },
            { partitionKey: phoneNumber },
        );
        const delivered = new Set();
        const deletes = [];

        for (const message of messages) {
            if (delivered.has(message.SmsSid)) {
                continue;
            }

            const dbResults = await this.documents.getDocuments(
                messageCollectionId,
                {
                    query: "SELECT * FROM c WHERE c.SmsSid = @smsSid AND c.SmsStatus = 'delivered'",
                    parameters: [{ name: '@smsSid', value: message.SmsSid }],
                },
                { partitionKey: message.To },
            );

            if (dbResults.length > 0) {
                delivered.add(message.SmsSid);
                deletes.push(this.#deleteMessage(message.id, message.To));
                log.warn(message, 'Deleted message.');
            }
        }

        await Promise.all(deletes);
    }

    /**
     * Get carrier data for a phone number.
     * @param {string} phoneNumber - Phone number in E.164 format
     * @returns {Promise<CarrierInfo>}
     */
    getPhoneNumberType(phoneNumber) {
        return new Promise((resolve, reject) => {
            this.client.phoneNumbers(phoneNumber).get(
                {
                    countryCode: 'US',
                    type: 'carrier',
                },
                (err, number) => {
                    if (err) {
                        reject(err);
                    } else {
                        resolve(number.carrier);
                    }
                },
            );
        });
    }

    /**
     * Get subscribed users for a given notification type.
     * @param {string} notificationType
     * @returns {Promise<SubscribedUser[]>}
     */
    async getSubscribedUsers(notificationType) {
        const notification = Object.values(notificationTypes).find(
            type => notificationType === type,
        );

        if (!notification) {
            return Promise.reject(Error('notificationType is not valid'));
        }

        const qb = new QueryBuilder();

        qb.select('displayName')
            .select('membershipId')
            .select('membershipType')
            .select('phoneNumber')
            .from(userCollectionId)
            .join('notifications')
            .where('type', notification)
            .where('enabled', true);

        return /** @type {Promise<SubscribedUser[]>} */ (
            this.documents.getDocuments(userCollectionId, qb.getQuery())
        );
    }

    /**
     * Get user from display name (gamer tag) and membership type (console).
     * @param {string} displayName
     * @param {number} membershipType
     * @param {boolean} [skipCache=false]
     * @returns {Promise<import('../helpers/documents.js').CosmosDocument<User> | undefined>}
     */
    async getUserByDisplayName(displayName, membershipType, skipCache = false) {
        const schema = z.object({
            displayName: z.string(),
            membershipType: z.number().int(),
            skipCache: z.boolean().optional(),
        });

        try {
            schema.parse({ displayName, membershipType, skipCache });
        } catch (err) {
            if (err instanceof z.ZodError) {
                const messages = err.issues.map(issue => issue.message);
                return Promise.reject(new Error(messages.join(',')));
            }
            return Promise.reject(err);
        }

        /** @type {import('../helpers/documents.js').CosmosDocument<User> | undefined} */
        let user;

        if (!skipCache) {
            user =
                /** @type {import('../helpers/documents.js').CosmosDocument<User> | undefined} */ (
                    await this.cacheService.getUser(displayName, membershipType)
                );

            if (user) {
                return user;
            }
        }

        const qb = new QueryBuilder();
        const documents = /** @type {import('../helpers/documents.js').CosmosDocument<User>[]} */ (
            await this.documents.getDocuments(
                userCollectionId,
                qb
                    .where('displayName', displayName)
                    .where('membershipType', membershipType)
                    .getQuery(),
            )
        );

        if (documents.length) {
            if (documents.length > 1) {
                throw new Error(
                    `more than 1 document found for displayName ${displayName} and membershipType ${membershipType}`,
                );
            }

            await this.cacheService.setUser(documents[0]);

            [user] = documents;
        }

        return user;
    }

    /**
     * Get user from email address.
     * @param {string} emailAddress
     * @returns {Promise<import('../helpers/documents.js').CosmosDocument<User> | undefined>}
     */
    async getUserByEmailAddress(emailAddress) {
        if (typeof emailAddress !== 'string' || !emailAddress) {
            return Promise.reject(new Error('emailAddress string is required'));
        }

        let user =
            /** @type {import('../helpers/documents.js').CosmosDocument<User> | undefined} */ (
                await this.cacheService.getUser(emailAddress)
            );

        if (user) {
            return user;
        }

        const qb = new QueryBuilder();
        const documents = /** @type {import('../helpers/documents.js').CosmosDocument<User>[]} */ (
            await this.documents.getDocuments(
                userCollectionId,
                qb.where('emailAddress', emailAddress).getQuery(),
            )
        );
        if (documents.length) {
            if (documents.length > 1) {
                throw new Error(`more than 1 document found for emailAddress ${emailAddress}`);
            }
            await this.cacheService.setUser(documents[0]);

            [user] = documents;
        }

        return user;
    }

    /**
     * Get user from their email address token.
     * @param {string} emailAddressToken
     * @returns {Promise<import('../helpers/documents.js').CosmosDocument<User> | undefined>}
     */
    async getUserByEmailAddressToken(emailAddressToken) {
        if (typeof emailAddressToken !== 'string' || !emailAddressToken) {
            return Promise.reject(new Error('emailAddressToken string is required.'));
        }

        const qb = new QueryBuilder();
        const documents = /** @type {import('../helpers/documents.js').CosmosDocument<User>[]} */ (
            await this.documents.getDocuments(
                userCollectionId,
                qb.where('membership.tokens.blob', emailAddressToken).getQuery(),
            )
        );
        if (documents.length > 1) {
            throw new Error(
                `more than 1 document found for emailAddressToken ${emailAddressToken}`,
            );
        }

        return documents[0];
    }

    /**
     * Get user from id.
     * @param {string} userId
     * @returns {Promise<import('../helpers/documents.js').CosmosDocument<User> | undefined>}
     */
    async getUserById(userId) {
        let user;

        if (typeof userId !== 'string' || !userId) {
            return Promise.reject(new Error('userId string is required'));
        }

        const qb = new QueryBuilder();
        const documents = /** @type {import('../helpers/documents.js').CosmosDocument<User>[]} */ (
            await this.documents.getDocuments(userCollectionId, qb.where('id', userId).getQuery())
        );
        if (documents) {
            if (documents.length > 1) {
                throw new Error(`more than 1 document found for userId ${userId}`);
            }

            [user] = documents;
        }

        return user;
    }

    /**
     * Get user from membership Id.
     * @param {string} membershipId
     * @returns {Promise<import('../helpers/documents.js').CosmosDocument<User> | undefined>}
     */
    async getUserByMembershipId(membershipId) {
        let user;

        if (typeof membershipId !== 'string' || !membershipId) {
            return Promise.reject(new Error('membershipId string is required'));
        }

        const qb = new QueryBuilder();
        const documents = /** @type {import('../helpers/documents.js').CosmosDocument<User>[]} */ (
            await this.documents.getDocuments(
                userCollectionId,
                qb.where('membershipId', membershipId).getQuery(),
            )
        );
        if (documents) {
            if (documents.length > 1) {
                throw new Error(`more than 1 document found for membershipId ${membershipId}`);
            }

            [user] = documents;
        }

        return user;
    }

    /**
     * Get user from phone number.
     * @param {string} phoneNumber
     * @returns {Promise<import('../helpers/documents.js').CosmosDocument<User> | undefined>}
     */
    async getUserByPhoneNumber(phoneNumber) {
        if (typeof phoneNumber !== 'string' || !phoneNumber) {
            return Promise.reject(Error('phoneNumber string is required'));
        }

        let user =
            /** @type {import('../helpers/documents.js').CosmosDocument<User> | undefined} */ (
                await this.cacheService.getUser(phoneNumber)
            );

        if (user) {
            return user;
        }

        const qb = new QueryBuilder();
        const documents = /** @type {import('../helpers/documents.js').CosmosDocument<User>[]} */ (
            await this.documents.getDocuments(
                userCollectionId,
                qb.where('phoneNumber', phoneNumber).getQuery(),
            )
        );
        if (documents.length) {
            if (documents.length > 1) {
                throw new Error(`more than 1 document found for phoneNumber ${phoneNumber}`);
            }
            await this.cacheService.setUser(documents[0]);

            [user] = documents;
        }

        return user;
    }

    /**
     * Update anonymous user.
     * @param {AnonymousUser} anonymousUser
     * @returns {Promise<void>}
     */
    async updateAnonymousUser(anonymousUser) {
        try {
            anonymousUserSchema.parse(anonymousUser);
        } catch (err) {
            if (err instanceof z.ZodError) {
                return Promise.reject(Error(JSON.stringify(err.issues)));
            }
            return Promise.reject(err);
        }

        const user = await this.getUserByDisplayName(
            anonymousUser.displayName,
            anonymousUser.membershipType,
        );

        if (user) {
            const mergedUser = { ...user, ...anonymousUser };
            return await this.documents
                .updateDocument(userCollectionId, mergedUser, mergedUser.membershipType)
                .then(() => this.cacheService.setUser(mergedUser));
        }

        throw new Error(
            `User with displayName ${anonymousUser.displayName} and membershipType ${anonymousUser.membershipType} not found`,
        );
    }

    /**
     * Update user.
     * @param {User} user
     * @returns {Promise<void>}
     */
    async updateUser(user) {
        try {
            userSchema.parse(user);
        } catch (err) {
            if (err instanceof z.ZodError) {
                return Promise.reject(Error(JSON.stringify(err.issues)));
            }
            return Promise.reject(err);
        }

        const userDocument = await this.getUserByDisplayName(user.displayName, user.membershipType);

        if (!userDocument) {
            throw new Error(
                `User with displayName ${user.displayName} and membershipType ${user.membershipType} not found`,
            );
        }

        Object.assign(userDocument, user);
        await this.documents.updateDocument(userCollectionId, userDocument, user.membershipType);

        return this.cacheService.setUser(userDocument);
    }

    /**
     * Replace the Bungie authentication information.
     * @param {string} userId
     * @param {BungieToken} bungie - Bungie OAuth token response
     * @returns {Promise<void>}
     */
    async updateUserBungie(userId, bungie) {
        const userDocument = await this.getUserById(userId);

        if (!userDocument) {
            throw new Error(`User with id ${userId} not found`);
        }

        userDocument.bungie = bungie;

        return await this.documents
            .updateDocument(userCollectionId, userDocument, userDocument.membershipType)
            .then(() => undefined);
    }
}

export default UserService;
