import defaults from 'lodash/defaults';
import isEmpty from 'lodash/isEmpty';
import Joi from 'joi';
import schemaDefaults from 'json-schema-defaults';
import validator, { filter } from 'is-my-json-valid';
import QueryBuilder from '../helpers/queryBuilder';
import log from '../helpers/log';
import notificationTypes from '../notifications/notification.types';
import validate from '../helpers/validate';

/**
 * Users Table Name
 * @type {string}
 */
const messageCollectionId = 'Messages';
const userCollectionId = 'Users';

/**
 * Schema for anonymous users.
 * @private
 */
const anonymousUserSchema = {
    name: 'AnonymousUser',
    type: 'object',
    properties: {
        displayName: {
            minLength: 3,
            maxLength: 16,
            required: true,
            type: 'string',
        },
        membershipId: {
            required: true,
            type: 'string',
        },
        membershipType: {
            required: true,
            type: 'integer',
            minimum: 1,
            maximum: 2,
        },
        profilePicturePath: {
            required: true,
            type: 'string',
        },
    },
};

/**
 * Schema for registered users.
 * @private
 */
const userSchema = {
    name: 'User',
    type: 'object',
    properties: {
        carrier: {
            readOnly: true,
            type: 'string',
        },
        dateRegistered: {
            format: 'date-time',
            readOnly: true,
            type: 'string',
        },
        emailAddress: {
            format: 'email',
            readOnly: true,
            required: true,
            type: 'string',
        },
        firstName: {
            required: true,
            type: 'string',
        },
        displayName: {
            minLength: 3,
            maxLength: 16,
            required: true,
            type: 'string',
        },
        isSubscribed: {
            default: true,
            type: 'boolean',
        },
        membershipId: {
            required: true,
            type: 'string',
        },
        membershipType: {
            required: true,
            type: 'integer',
            minimum: 1,
            maximum: 2,
        },
        lastName: {
            required: true,
            type: 'string',
        },
        notifications: {
            default: [],
            required: false,
            type: 'array',
            uniqueItems: true,
            items: {
                type: 'object',
            },
        },
        patches: {
            default: [],
            required: false,
            type: 'array',
            uniqueItems: true,
            items: {
                type: 'object',
            },
        },
        phoneNumber: {
            readOnly: true,
            required: true,
            type: 'string',
            format: 'phone',
        },
        roles: {
            default: ['User'],
            required: false,
            type: 'array',
            uniqueItems: true,
            items: {
                type: 'string',
            },
        },
        type: {
            readOnly: true,
            type: 'string',
        },
    },
    additionalProperties: true,
};

/**
 * Schema for user notifications.
 * @private
 */
const notificationSchema = {
    name: 'User',
    type: 'object',
    properties: {
        enabled: {
            required: true,
            type: 'boolean',
        },
        type: {
            required: true,
            type: 'string',
        },
    },
    additionalProperties: false,
};

/**
 * User Service Class
 */
class UserService {
    /**
     * @constructor
     */
    constructor(options) {
        validate(options, {
            cacheService: Joi.object().required(),
            documentService: Joi.object().required(),
            client: Joi.object().required(),
        });

        this.cacheService = options.cacheService;
        this.documents = options.documentService;

        this.client = options.client;
    }

    /**
     * Add message to the user's notification history.
     * @param displayName
     * @param membershipType
     * @param message
     * @returns {Promise}
     */
    async addUserMessage(message) {
        return await this.documents.createDocument(messageCollectionId, {
            DateTime: new Date().toISOString(),
            ...message,
        });
    }

    /**
     * Create an anonymous user.
     * @param user
     * @returns {*}
     */
    async createAnonymousUser(user) {
        const validateUser = validator(anonymousUserSchema, {
            greedy: true,
        });

        if (!validateUser(user)) {
            return Promise.reject(Error(JSON.stringify(validateUser.errors)));
        }

        const existingUser = await this
            .getUserByDisplayName(user.displayName, user.membershipType, true);

        if (existingUser) {
            if (existingUser.dateRegistered) {
                return Promise.reject(new Error('User is already registered.'));
            }

            return Promise.reject(new Error('Anonymous user already signed in.'));
        }

        return await this.documents.createDocument(userCollectionId, user);
    }

    /**
     * Create a user.
     * @param user {Object}
     * @returns {*}
     */
    async createUser(user) {
        let errors = [];
        const validateNotifications = validator(notificationSchema);
        const validateUser = validator(userSchema);

        if (!validateUser(user)) {
            return Promise.reject(new Error(JSON.stringify(validateUser.errors)));
        }

        user.notifications.forEach(notification => {
            if (!validateNotifications(notification)) {
                errors = [...errors, ...validateNotifications.errors];
            }
        });

        if (errors.length) {
            return Promise.reject(new Error(JSON.stringify(errors)));
        }

        let existingUser = await this.getUserByPhoneNumber(user.phoneNumber);
        if (existingUser) {
            return Promise.reject(new Error(`The phone number, ${user.phoneNumber}, is already registered.`));
        }

        existingUser = await this.getUserByEmailAddress(user.emailAddress);
        if (existingUser) {
            return Promise.reject(new Error(`The email address, ${user.emailAddress}, is already registered.`));
        }

        existingUser = await this.getUserByDisplayName(user.displayName, user.membershipType, true);
        const carrier = await this.getPhoneNumberType(user.phoneNumber);
        const filterUser = filter(userSchema);

        user.carrier = carrier.name;
        user.type = carrier.type;
        userSchema.additionalProperties = false;

        const filteredUser = filterUser(user);

        defaults(filteredUser, schemaDefaults(userSchema));
        existingUser = { ...existingUser, ...filteredUser };

        return await this.documents.updateDocument(userCollectionId, existingUser);
    }

    /**
     * Delete a message.
     * @param {string} messageId
     * @param {string} phoneNumber
     * @returns {Promise.<T>}
     */
    async #deleteMessage(messageId, phoneNumber) {
        return await this.documents
            .deleteDocumentById(messageCollectionId, messageId, phoneNumber);
    }

    /**
     * Delete a user.
     * @param {string} documentId
     * @param {number} membershipType
     * @returns {Promise.<T>}
     */
    // eslint-disable-next-line no-unused-private-class-members
    async #deleteUser(documentId, membershipType) {
        return await this.documents
            .deleteDocumentById(userCollectionId, documentId, membershipType);
    }

    /**
     * Delete messages with the status 'queued' or 'sent' given the message was 'delivered'.
     * @param {string} phoneNumber
     */
    async deleteUserMessages(phoneNumber) {
        const messages = await this.documents.getDocuments(
            messageCollectionId,
            `SELECT * FROM c WHERE c.SmsStatus != 'delivered' AND c.To = '${phoneNumber}'`,
        );
        const delivered = new Set();

        for (const message of messages) {
            const received = delivered.has(message.SmsSid) || await this.documents.getDocuments(
                messageCollectionId,
                `SELECT * FROM c WHERE c.SmsSid = '${message.SmsSid}' AND c.SmsStatus = 'delivered'`,
            );

            if (received.length) {
                delivered.add(message.SmsSid);
                this.#deleteMessage(message.id, message.To);
                log.warn(message, 'Deleted message.');
            }
        }
    }

    /**
     * Get carrier data for a phone number.
     * @param phoneNumber
     * @returns {Promise}
     */
    getPhoneNumberType(phoneNumber) {
        return new Promise((resolve, reject) => {
            this.client.phoneNumbers(phoneNumber).get({
                countryCode: 'US',
                type: 'carrier',
            }, (err, number) => {
                if (err) {
                    reject(err);
                } else {
                    resolve(number.carrier);
                }
            });
        });
    }

    /**
     * Get subscribed users.
     * @param notificationType
     * @returns {*|Array.User}
     */
    async getSubscribedUsers(notificationType) {
        const notification = Object.values(notificationTypes)
            .find(type => notificationType === type);

        if (!notification) {
            return Promise.reject(Error('notificationType is not valid'));
        }

        const qb = new QueryBuilder();

        qb
            .select('displayName')
            .select('membershipId')
            .select('membershipType')
            .select('phoneNumber')
            .from(userCollectionId)
            .join('notifications')
            .where('type', notification)
            .where('enabled', true);

        return await this.documents.getDocuments(userCollectionId, qb.getQuery(), {
            enableCrossPartitionQuery: true,
        });
    }

    /**
     * Get user from display name (gamer tag) and membership type (console).
     * @param displayName
     * @param membershipType
     * @returns {Promise}
     */
    async getUserByDisplayName(displayName, membershipType, skipCache = false) {
        const schema = {
            displayName: Joi.string().required(),
            membershipType: Joi.number().required(),
            skipCache: Joi.boolean().optional(),
        };
        const error = validate(
            { displayName, membershipType, skipCache },
            schema,
            { abortEarly: false },
        );

        if (error) {
            const messages = error.details.map(detail => detail.message);

            return Promise.reject(messages.join(','));
        }

        let user = await this.cacheService.getUser(displayName, membershipType);

        if (!skipCache && user) {
            return user;
        }

        const qb = new QueryBuilder();
        const documents = await this.documents.getDocuments(
            userCollectionId,
            qb.where('displayName', displayName).where('membershipType', membershipType).getQuery(),
        );

        if (documents.length) {
            if (documents.length > 1) {
                throw new Error(`more than 1 document found for displayName ${displayName} and membershipType ${membershipType}`);
            }

            await this.cacheService.setUser(documents[0]);

            [user] = documents;
        }

        return user;
    }

    /**
     * Get user from email address.
     * @param emailAddress
     * @returns {Promise}
     */
    async getUserByEmailAddress(emailAddress) {
        if (typeof emailAddress !== 'string' || isEmpty(emailAddress)) {
            return Promise.reject(new Error('emailAddress string is required'));
        }

        let user = await this.cacheService.getUser(emailAddress);

        if (user) {
            return user;
        }

        const qb = new QueryBuilder();
        const documents = await this.documents.getDocuments(
            userCollectionId,
            qb.where('emailAddress', emailAddress).getQuery(),
            {
                enableCrossPartitionQuery: true,
            },
        );
        if (documents.length) {
            if (documents.length > 1) {
                throw new Error(`more than 1 document found for emailAddress ${emailAddress}`);
            }
            this.cacheService.setUser(documents[0]);

            [user] = documents;
        }

        return user;
    }

    /**
     * Get user from their email address token.
     * @param emailAddressToken
     * @returns {Promise}
     */
    async getUserByEmailAddressToken(emailAddressToken) {
        if (typeof emailAddressToken !== 'string' || isEmpty(emailAddressToken)) {
            return Promise.reject(new Error('emailAddressToken string is required.'));
        }

        const qb = new QueryBuilder();
        const documents = await this.documents.getDocuments(
            userCollectionId,
            qb.where('membership.tokens.blob', emailAddressToken).getQuery(),
            {
                enableCrossPartitionQuery: true,
            },
        );
        if (documents) {
            if (documents.length > 1) {
                throw new Error(`more than 1 document found for emailAddressToken ${emailAddressToken}`);
            }

            return documents[0];
        }

        throw new Error('documents undefined');
    }

    /**
     * Get user from id.
     * @param userId
     * @returns {Promise}
     */
    async getUserById(userId) {
        let user;

        if (typeof userId !== 'string' || isEmpty(userId)) {
            return Promise.reject(new Error('userId string is required'));
        }

        const qb = new QueryBuilder();
        const documents = await this.documents.getDocuments(
            userCollectionId,
            qb.where('id', userId).getQuery(),
            {
                enableCrossPartitionQuery: true,
            },
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
     * @param membershipId
     * @returns {Promise}
     */
    async getUserByMembershipId(membershipId) {
        let user;

        if (typeof membershipId !== 'string' || isEmpty(membershipId)) {
            return Promise.reject(new Error('membershipId string is required'));
        }

        const qb = new QueryBuilder();
        const documents = await this.documents.getDocuments(
            userCollectionId,
            qb.where('membershipId', membershipId).getQuery(),
            {
                enableCrossPartitionQuery: true,
            },
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
     * @param phoneNumber
     * @returns {Promise}
     */
    async getUserByPhoneNumber(phoneNumber) {
        if (typeof phoneNumber !== 'string' || isEmpty(phoneNumber)) {
            return Promise.reject(Error('phoneNumber string is required'));
        }

        let user = await this.cacheService.getUser(phoneNumber);

        if (user) {
            return user;
        }

        const qb = new QueryBuilder();
        const documents = await this.documents.getDocuments(
            userCollectionId,
            qb.where('phoneNumber', phoneNumber).getQuery(),
            {
                enableCrossPartitionQuery: true,
            },
        );
        if (documents.length) {
            if (documents.length > 1) {
                throw new Error(`more than 1 document found for phoneNumber ${phoneNumber}`);
            }
            this.cacheService.setUser(documents[0]);

            [user] = documents;
        }

        return user;
    }

    /**
     * Get user from phone number token.
     * @param phoneNumberToken
     * @returns {Promise}
     */
    async getUserByPhoneNumberToken(phoneNumberToken) {
        if (typeof phoneNumberToken !== 'number') {
            return Promise.reject(Error('phoneNumberToken number is required.'));
        }

        const qb = new QueryBuilder();
        const documents = await this.documents.getDocuments(
            userCollectionId,
            qb.where('membership.tokens.code', phoneNumberToken).getQuery(),
            {
                enableCrossPartitionQuery: true,
            },
        );
        if (documents) {
            if (documents.length > 1) {
                throw new Error(`more than 1 document found for phoneNumberToken ${phoneNumberToken}`);
            }

            return documents[0];
        }

        throw new Error('documents undefined');
    }

    /**
     * Update anonymous user.
     * @param anonymousUser {Object}
     * @returns {Promise}
     */
    async updateAnonymousUser(anonymousUser) {
        const validateUser = validator(anonymousUserSchema);

        if (!validateUser(anonymousUser)) {
            return Promise.reject(new Error(JSON.stringify(validateUser.errors)));
        }

        const user = await this
            .getUserByDisplayName(anonymousUser.displayName, anonymousUser.membershipType);

        if (user) {
            return await this.documents.updateDocument(userCollectionId, anonymousUser)
                .then(() => this.cacheService.setUser(anonymousUser));
        }

        throw new Error(`user not found ${JSON.stringify(anonymousUser)}`);
    }

    /**
     * Update user.
     * @param user {Object}
     * @returns {Promise}
     */
    async updateUser(user) {
        const validateUser = validator(userSchema);

        if (!validateUser(user)) {
            return Promise.reject(Error(JSON.stringify(validateUser.errors)));
        }

        const userDocument = await this.getUserByDisplayName(user.displayName, user.membershipType);
        Object.assign(userDocument, user);

        return await this.documents.updateDocument(userCollectionId, userDocument)
            .then(() => this.cacheService.setUser(userDocument));
    }

    /**
     * Replace the Bungie authentication information.
     * @param userId
     * @param bungie
     * @returns {Promise}
     */
    async updateUserBungie(userId, bungie) {
        const userDocument = await this.getUserById(userId);

        if (!userDocument) {
            throw new Error(`user not found with id ${userId}`);
        }

        userDocument.bungie = bungie;

        return await this.documents.updateDocument(userCollectionId, userDocument)
            .then(() => undefined);
    }
}

export default UserService;
