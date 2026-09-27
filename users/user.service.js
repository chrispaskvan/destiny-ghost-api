// @ts-check
import { StatusCodes } from 'http-status-codes';
import { z } from 'zod';
import supportedMembershipTypes from '../helpers/bungie.membershipTypes.js';
import QueryBuilder from '../helpers/queryBuilder.js';
import log from '../helpers/log.js';
import { withRetry } from '../helpers/retry.js';
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
    /**
     * Bungie supplies this, so the bounds describe the platforms rather than a
     * form: a Steam persona name runs to 32 characters, well past the 16 an
     * Xbox gamertag or a PSN online ID stops at.
     */
    displayName: z.string().min(3).max(32),
    membershipId: z.string(),
    membershipType: z.literal(supportedMembershipTypes),
    profilePicturePath: z.string(),
});

/**
 * The identity fields a platform move rewrites. Picked from
 * `anonymousUserSchema` rather than restated, so the supported platform list
 * keeps one definition - `membershipType` is the Cosmos partition key, and
 * `movePlatform` is the only write that chooses a new one.
 * @private
 */
const platformMembershipSchema = anonymousUserSchema.pick({
    displayName: true,
    membershipId: true,
    membershipType: true,
});

/**
 * Schema for user notifications.
 * @private
 */
const notificationSchema = z
    .object({
        enabled: z.boolean(),
        type: z.enum(Object.values(notificationTypes)),
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
    /**
     * When the consent change that produced `isSubscribed` was received, in
     * epoch milliseconds. A watermark, not an audit field: a consent write
     * carrying an older stamp is a superseded intent and is discarded.
     */
    consentUpdatedAt: z.number().int().optional(),
    membershipId: z.string(),
    membershipType: z.literal(supportedMembershipTypes),
    lastName: z.string(),
    notifications: z.array(notificationSchema).default([]),
    patches: z.array(z.object({})).default([]),
    phoneNumber: z.string(),
    roles: z.array(z.string()).default(['User']),
    type: z.string().optional(),
    /**
     * Set by `movePlatform` on the copy it is superseding, naming the platform
     * the record moved to. Its presence, not its value, is what matters: a
     * marked document is not the live record and no lookup returns it.
     */
    movedTo: z.number().int().optional(),
    bungie: storedBungieTokenSchema.optional(),
});

/**
 * The HTTP status Cosmos attached to a rejection. The driver puts it on `code`
 * and, in places, on `statusCode`; read both rather than depend on which.
 * @param {*} err
 * @returns {number | undefined}
 */
function cosmosStatus(err) {
    return typeof err?.code === 'number' ? err.code : err?.statusCode;
}

/**
 * Cosmos statuses worth a second attempt: request timeout, throttling, retry-
 * with, and anything the service blames on itself. A 400, 401 or 403 will
 * never succeed on a retry, and this runs inside the OAuth callback.
 * @param {*} err
 * @returns {boolean}
 */
function isTransientCosmosError(err) {
    const status = cosmosStatus(err);

    if (typeof status !== 'number') {
        return false;
    }

    return status === 408 || status === 429 || status === 449 || status >= 500;
}

/**
 * Copy the consent watermark from the stored document onto the merged one,
 * discarding whatever the caller supplied.
 *
 * `updateUser` and `updateAnonymousUser` both merge caller-supplied fields
 * over a stored document, and their callers hand them a raw request body -
 * `users/user.routes.js` signs a user up with `const { body: user } = req`.
 * A planted far-future stamp would make `applyConsent` treat every real
 * STOP as superseded: acknowledged to the sender, never written, and the
 * number left in the next broadcast. Only `updateUserSubscription` moves it.
 * @param {Record<string, *>} merged
 * @param {Record<string, *> | undefined} stored
 */
function preserveConsentWatermark(merged, stored) {
    if (stored?.consentUpdatedAt === undefined) {
        delete merged.consentUpdatedAt;

        return;
    }

    merged.consentUpdatedAt = stored.consentUpdatedAt;
}

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
 * Minimal user projection returned by `getSubscribedUsers`. Already filtered
 * to exclude users who have opted out via SMS (isSubscribed === false).
 * @typedef {Object} SubscribedUser
 * @property {string} displayName
 * @property {boolean} [isSubscribed]
 * @property {string} membershipId
 * @property {number} membershipType
 * @property {string} phoneNumber
 */

/**
 * The consent projection returned by `getConsentByPhoneNumber`: the two
 * fields the delivery gate decides on, and nothing else.
 * @typedef {Object} UserConsent
 * @property {boolean} [isSubscribed]
 * @property {{ enabled: boolean, type: string }[]} [notifications]
 * @property {number} [consentUpdatedAt] - Epoch milliseconds of the change
 * that produced `isSubscribed`. The gate compares it against the marker an
 * acknowledgement left behind, to tell a pending change from an applied one.
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
                /**
                 * The document itself used to be the merge object, which put
                 * `Body` - the text of the message, and so the verification
                 * code on a verification SMS - into the log. Which message was
                 * removed is answerable from its identifiers.
                 */
                log.warn(
                    { smsSid: message.SmsSid, messageId: message.id, phoneNumber: message.To },
                    'Deleted message.',
                );
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
     * Get subscribed users for a given notification type. Excludes users who
     * have opted out via SMS (isSubscribed === false); users missing the
     * field are treated as subscribed, since it defaults to true and existing
     * documents predate the field.
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
            .select('isSubscribed')
            .select('membershipId')
            .select('membershipType')
            .select('phoneNumber')
            .from(userCollectionId)
            .join('notifications')
            .where('type', notification)
            .where('enabled', true);

        const documents = /** @type {SubscribedUser[]} */ (
            await this.documents.getDocuments(userCollectionId, qb.getQuery())
        );

        return documents.filter(document => document.isSubscribed !== false);
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
            user = UserService.#oneLiveDocument(
                documents,
                `displayName ${displayName} and membershipType ${membershipType}`,
            );

            if (user) {
                await this.#cache(user);
            }
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
            user = UserService.#oneLiveDocument(documents, `emailAddress ${emailAddress}`);

            if (user) {
                await this.#cache(user);
            }
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
            user = UserService.#oneLiveDocument(documents, `userId ${userId}`);
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
            user = UserService.#oneLiveDocument(documents, `membershipId ${membershipId}`);
        }

        return user;
    }

    /**
     * Get user from their Bungie.net membership id.
     *
     * The platform `membershipId` changes when a player moves the membership
     * that owns their cross-saved data; this one does not, which makes it the
     * only way to recognise such an account as a returning user.
     *
     * Documents written before the full token was persisted carry no
     * `bungie.membership_id` and will not match. They pick one up on their next
     * ordinary sign-in, so the gap closes itself rather than needing a backfill.
     * @param {string} bungieMembershipId
     * @returns {Promise<import('../helpers/documents.js').CosmosDocument<User> | undefined>}
     */
    async getUserByBungieMembershipId(bungieMembershipId) {
        /**
         * Resolves undefined rather than rejecting, unlike its siblings. This
         * is a fallback behind `getUserByMembershipId`, so a missing id means
         * "nothing more to try" - and rejecting would turn a brand-new user
         * whose token lacked the field into a failed sign-in, where before
         * this lookup existed they were simply created.
         */
        if (typeof bungieMembershipId !== 'string' || !bungieMembershipId) {
            return undefined;
        }

        const qb = new QueryBuilder();
        const documents = /** @type {import('../helpers/documents.js').CosmosDocument<User>[]} */ (
            await this.documents.getDocuments(
                userCollectionId,
                qb.where('bungie.membership_id', bungieMembershipId).getQuery(),
            )
        );

        /**
         * The one lookup that can see a superseded copy, because it is the path
         * `signIn` recovers through: a move whose successor was never created
         * would otherwise leave the player invisible.
         *
         * Live wins when there is one. A superseded copy is returned only when
         * nothing live matches, which is exactly the interrupted-move case. The
         * order matters after a failed delete: both copies carry the same
         * Bungie id, and preferring the live one is what lets a player moving
         * back to their old platform reach `movePlatform` instead of a throw.
         */
        const live = documents.filter(({ movedTo }) => movedTo === undefined);
        const candidates = live.length ? live : documents;

        if (candidates.length > 1) {
            throw new Error(
                `more than 1 document found for bungie.membership_id ${bungieMembershipId}`,
            );
        }

        return candidates[0];
    }

    /**
     * Read only the consent fields for a number, always from Cosmos.
     *
     * `getUserByPhoneNumber` would answer the same question, but it selects
     * the whole document - Bungie tokens, message history, the lot - to decide
     * on two fields, and the delivery gate calls it on every message in a
     * broadcast. Projecting cuts what crosses the wire without changing the
     * fan-out: `phoneNumber` is not the partition key (`membershipType` is),
     * so this stays a cross-partition query either way.
     *
     * Never cached, in either direction. The gate's whole purpose is to see a
     * STOP the cache could still be an hour behind on, and a two-field
     * projection must not be written back over the full cached document.
     * @param {string} phoneNumber
     * @returns {Promise<UserConsent | undefined>}
     */
    async getConsentByPhoneNumber(phoneNumber) {
        if (typeof phoneNumber !== 'string' || !phoneNumber) {
            return Promise.reject(Error('phoneNumber string is required'));
        }

        const qb = new QueryBuilder();
        const documents = /** @type {UserConsent[]} */ (
            await this.documents.getDocuments(
                userCollectionId,
                qb
                    .select('movedTo')
                    .select('isSubscribed')
                    .select('notifications')
                    .select('consentUpdatedAt')
                    .where('phoneNumber', phoneNumber)
                    .getQuery(),
            )
        );

        return /** @type {*} */ (
            UserService.#oneLiveDocument(documents, `phoneNumber ${phoneNumber}`)
        );
    }

    /**
     * Get user from phone number.
     *
     * `skipCache` bypasses the read only: the Cosmos result is still written
     * back below, refreshing both the full document and the phone-number
     * pointer. A caller that is about to write needs it, because the cached
     * copy can hold an `_etag` that Cosmos has already superseded, and
     * `updateDocument` sends that etag as an `IfMatch` precondition.
     * @param {string} phoneNumber
     * @param {boolean} [skipCache=false]
     * @returns {Promise<import('../helpers/documents.js').CosmosDocument<User> | undefined>}
     */
    async getUserByPhoneNumber(phoneNumber, skipCache = false) {
        if (typeof phoneNumber !== 'string' || !phoneNumber) {
            return Promise.reject(Error('phoneNumber string is required'));
        }

        /** @type {import('../helpers/documents.js').CosmosDocument<User> | undefined} */
        let user;

        if (!skipCache) {
            user =
                /** @type {import('../helpers/documents.js').CosmosDocument<User> | undefined} */ (
                    await this.cacheService.getUser(phoneNumber)
                );

            if (user) {
                return user;
            }
        }

        const qb = new QueryBuilder();
        const documents = /** @type {import('../helpers/documents.js').CosmosDocument<User>[]} */ (
            await this.documents.getDocuments(
                userCollectionId,
                qb.where('phoneNumber', phoneNumber).getQuery(),
            )
        );
        if (documents.length) {
            user = UserService.#oneLiveDocument(documents, `phoneNumber ${phoneNumber}`);

            if (user) {
                await this.#cache(user);
            }
        }

        return user;
    }

    /**
     * Replace a stored document and cache what Cosmos hands back.
     *
     * Cosmos stamps a fresh `_etag` on every successful replace, and
     * `updateDocument` sends that etag as an `IfMatch` precondition on the
     * next write. Caching the copy we sent instead of the one it stored would
     * therefore leave the cache holding an etag that is already superseded,
     * and the following write would fail its own precondition for the rest of
     * the cache's hour - deterministically, not as a race.
     *
     * Falls back to the local document only when the driver returns nothing,
     * which the Cosmos client does not do on a successful replace.
     * @param {import('../helpers/documents.js').CosmosDocument<User>} document
     * @param {number} partitionKey
     * @returns {Promise<void>}
     */
    async #replaceAndCache(document, partitionKey) {
        const updatedDocument = await this.documents.updateDocument(
            userCollectionId,
            document,
            partitionKey,
        );

        return this.#cache(updatedDocument ?? document);
    }

    /**
     * Refresh the cache without letting its failure undo a successful read or
     * write.
     *
     * Cosmos is the source of truth, so a cache that cannot be reached should
     * cost a repeat lookup, not the operation. It matters most to SMS consent:
     * the inline fallback runs precisely because Redis was unavailable, and
     * rejecting here would fail the very write that exists to survive that.
     * Reporting a completed write as failed is worse still, because the caller
     * then retries something that already landed.
     *
     * The cost is a superseded entry left behind until its hour is up. Callers
     * about to write read with `skipCache`, and a precondition failure is
     * retried, so that resolves itself.
     * @param {import('../helpers/documents.js').CosmosDocument<User>} document
     * @returns {Promise<void>}
     */
    async #cache(document) {
        try {
            await this.cacheService.setUser(document);
        } catch (err) {
            log.warn(
                { err, userId: document.id },
                'Failed to cache the user; continuing without it.',
            );
        }
    }

    /**
     * Move a user to the platform that now owns their cross-saved data.
     *
     * `membershipType` is the Cosmos partition key, and a partition key is
     * fixed for the life of a document: no update changes it, and there is no
     * cross-partition transaction to do it atomically. So the record is
     * recreated under the new platform and the old copy removed, carrying the
     * registration - phone number, notifications, consent - across with it.
     *
     * Create first, delete second. A failure between the two leaves a
     * duplicate, which is visible and recoverable; the other order would leave
     * a registered user with no document at all.
     *
     * Deliberately skips `userSchema`, like `updateUserSubscription`: the
     * stored document is already in hand, and a legacy record that fails the
     * schema must still be movable. Only the incoming identity is validated,
     * because it chooses the new partition.
     * @param {import('../helpers/documents.js').CosmosDocument<User>} storedUser
     * @param {Record<string, *>} membership - the membership Bungie now reports
     * @returns {Promise<import('../helpers/documents.js').CosmosDocument<User>>}
     */
    async movePlatform(storedUser, membership) {
        try {
            platformMembershipSchema.parse(membership);
        } catch (err) {
            if (err instanceof z.ZodError) {
                return Promise.reject(Error(JSON.stringify(err.issues)));
            }
            return Promise.reject(err);
        }

        const { membershipType } = /** @type {{ membershipType: number }} */ (membership);

        const { _etag, _rid, _self, _attachments, _ts, movedTo, ...carried } = storedUser;

        /**
         * Mark the old copy before anything is duplicated. The write is on its
         * own partition, so a failure here stops the move with nothing lost -
         * and once it lands, no lookup will return that copy again however many
         * times it is written to afterwards.
         *
         * Sent without the etag, so it is unconditional. Marking is idempotent,
         * and two sign-ins arriving together would otherwise have the second
         * fail its precondition on the mark the first just wrote.
         */
        await this.documents.updateDocument(
            userCollectionId,
            /** @type {*} */ ({ ...carried, movedTo: membershipType }),
            storedUser.membershipType,
        );

        /**
         * Directly after the mark, not at the end: everything below can throw,
         * and a cached copy outlives the failure by an hour. It holds the
         * record unmarked, so display-name lookups on the old identity would
         * keep resolving to something no query returns any more.
         */
        try {
            await this.cacheService.deleteUser(storedUser);
        } catch (err) {
            log.warn(
                { err, userId: storedUser.id },
                'Failed to clear the cache while moving the user; continuing without it.',
            );
        }

        const moved = { ...carried, ...membership };
        /** @type {*} */
        let created;

        try {
            created = await this.documents.createDocument(userCollectionId, moved);
        } catch (err) {
            if (cosmosStatus(err) !== StatusCodes.CONFLICT) {
                throw err;
            }

            /**
             * Something already holds this id on the target partition: a
             * concurrent sign-in that moved first, or a superseded copy from a
             * platform the player is moving back to. Replacing suits both -
             * `moved` is the current record, and it carries no mark, so the
             * target comes back to life.
             */
            log.info(
                { userId: storedUser.id, membershipType },
                'The target already holds this record; replacing it.',
            );

            created = await this.documents.updateDocument(
                userCollectionId,
                /** @type {*} */ (moved),
                membershipType,
            );
        }

        try {
            /**
             * Retried on the statuses that can clear on their own. The old copy
             * is marked either way, so a leftover is inert rather than
             * dangerous - this is about tidiness, which is why it does not get
             * to spend eight seconds of an OAuth callback failing.
             */
            await withRetry(
                () =>
                    this.documents.deleteDocumentById(
                        userCollectionId,
                        storedUser.id,
                        storedUser.membershipType,
                    ),
                { baseDelay: 100, maxRetries: 3, shouldRetry: isTransientCosmosError },
            );
        } catch (err) {
            if (cosmosStatus(err) !== StatusCodes.NOT_FOUND) {
                log.error(
                    { err, userId: storedUser.id, membershipType: storedUser.membershipType },
                    'Moved the user but could not remove the superseded document.',
                );
            }
        }

        const movedDocument =
            /** @type {import('../helpers/documents.js').CosmosDocument<User>} */ (
                created ?? moved
            );

        await this.#cache(movedDocument);

        return movedDocument;
    }

    /**
     * Reduce a lookup result to the one live document, or throw.
     *
     * `movePlatform` marks the copy it supersedes before creating the
     * replacement, so a marked document is never the live record. Filtering on
     * the mark rather than comparing `_ts` matters because a superseded copy
     * can still be written to - a session predating the move still carries the
     * old `displayName` and `membershipType`, and a player moving cross save
     * back lands on it by `membershipId`. Either write would make the stale
     * copy the newest, and a timestamp rule would then hand back the consent
     * it never received.
     *
     * Two live documents remain an error: that is a different bug, and quietly
     * picking a winner would hide it.
     * @param {import('../helpers/documents.js').CosmosDocument<*>[]} documents
     * @param {string} description - what was looked up, for the error message
     * @returns {import('../helpers/documents.js').CosmosDocument<*> | undefined}
     */
    static #oneLiveDocument(documents, description) {
        const live = documents.filter(({ movedTo }) => movedTo === undefined);

        if (live.length > 1) {
            throw new Error(`more than 1 document found for ${description}`);
        }

        return live[0];
    }

    /**
     * Take the mark off a record whose move never created its successor.
     *
     * `movePlatform` marks before it creates, so a failure in between leaves a
     * marked document with nothing to supersede it - invisible to every lookup
     * but the Bungie-id one. When the player signs in again on the platform
     * they were already on, that is the record, and it needs to be live again.
     * @param {import('../helpers/documents.js').CosmosDocument<User>} storedUser
     * @returns {Promise<void>}
     */
    async clearPlatformMove(storedUser) {
        const { movedTo: _movedTo, ...live } = storedUser;

        log.info(
            { userId: storedUser.id, membershipType: storedUser.membershipType },
            'Restoring a record whose platform move never completed.',
        );

        return await this.#replaceAndCache(/** @type {*} */ (live), storedUser.membershipType);
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

            preserveConsentWatermark(mergedUser, user);

            return await this.#replaceAndCache(mergedUser, mergedUser.membershipType);
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

        const { consentUpdatedAt } = userDocument;

        Object.assign(userDocument, user);
        preserveConsentWatermark(userDocument, { consentUpdatedAt });

        return this.#replaceAndCache(userDocument, /** @type {number} */ (user.membershipType));
    }

    /**
     * Flip a user's SMS consent on the document the caller already holds.
     *
     * `receivedAt` is stamped alongside it so a later write can tell whether
     * it is applying a newer intent or replaying a superseded one.
     *
     * Deliberately skips `updateUser`'s schema re-parse and its second lookup
     * by displayName: both can reject a legacy record that
     * `getUserByPhoneNumber` just returned, and neither adds anything when the
     * document is already in hand. Carrier compliance rides on this write, so
     * the fewer ways it can fail, the better.
     * @param {import('../helpers/documents.js').CosmosDocument<User>} userDocument
     * @param {boolean} isSubscribed
     * @param {number} receivedAt - Epoch milliseconds the change was received.
     * @returns {Promise<void>}
     */
    async updateUserSubscription(userDocument, isSubscribed, receivedAt) {
        userDocument.isSubscribed = isSubscribed;
        userDocument.consentUpdatedAt = receivedAt;

        return this.#replaceAndCache(userDocument, userDocument.membershipType);
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

        /**
         * This used to write to Cosmos without touching the cache, so a reader
         * could keep picking up the superseded token for the rest of the
         * cache's hour.
         */
        return await this.#replaceAndCache(userDocument, userDocument.membershipType);
    }
}

export default UserService;
