const _ = require('underscore'),
    QueryBuilder = require('../helpers/queryBuilder'),
    defaults = require('json-schema-defaults'),
    notificationTypes = require('../notifications/notification.types'),
    twilio = require('twilio'),
    { accountSid, authToken } = require('../settings/twilio.' + (process.env.NODE_ENV || 'development') + '.json'),
    validator = require('is-my-json-valid');

/**
 * Users Table Name
 * @type {string}
 */
const collectionId = 'Users';

/**
 * Schema for anonymous users.
 * @private
 */
const anonymousUserSchema = {
    name: 'User',
    type: 'object',
    properties: {
        displayName: {
            minLength: 3,
            maxLength: 16,
            required: true,
            type: 'string'
        },
        membershipId: {
            required: true,
            type: 'string'
        },
        membershipType: {
            required: true,
            type: 'integer',
            minimum: 1,
            maximum: 2
        },
        profilePicturePath: {
            type: 'string'
        },
        membership: {
            type: 'object'
        }
    }
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
            type: 'string'
        },
        dateRegistered: {
            format: 'date-time',
            readOnly: true,
            type: 'string'
        },
        emailAddress: {
            format: 'email',
            readOnly: true,
            required: true,
            type: 'string'
        },
        firstName: {
            required: true,
            type: 'string'
        },
        displayName: {
            minLength: 3,
            maxLength: 16,
            required: true,
            type: 'string'
        },
        isSubscribed: {
            default: true,
            type: 'boolean'
        },
        membershipId: {
            required: true,
            type: 'string'
        },
        membershipType: {
            required: true,
            type: 'integer',
            minimum: 1,
            maximum: 2
        },
        lastName: {
            required: true,
            type: 'string'
        },
        messages: {
            default: [],
            required: false,
            type: 'array',
            uniqueItems: true,
            items: {
                type: 'object'
            }
        },
        notifications: {
            default: [],
            required: false,
            type: 'array',
            uniqueItems: true,
            items: {
                type: 'object'
            }
        },
        phoneNumber: {
            readOnly: true,
            required: true,
            type: 'string',
            format: 'phone'
        },
        roles: {
            default: ['User'],
            required: false,
            type: 'array',
            uniqueItems: true,
            items: {
                type: 'string'
            }
        },
        type: {
            readOnly: true,
            type: 'string'
        }
    },
    additionalProperties: true
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
            type: 'boolean'
        },
        type: {
            required: true,
            type: 'string'
        },
        messages: {
            default: [],
            required: false,
            type: 'array',
            uniqueItems: true,
            items: {
                type: 'object'
            }
        }
    },
    additionalProperties: false
};

/**
 * User Service Class
 */
class UserService {
    /**
     * @constructor
     */
    constructor(options) {
        this.cacheService = options.cacheService;
        this.documents = options.documentService;

        this.client = new twilio(accountSid, authToken);
    }

    /**
     * Add message to the user's notification history.
     * @param displayName
     * @param membershipType
     * @param message
     * @param notificationType
     * @returns {Promise}
     */
    addUserMessage(displayName, membershipType, message, notificationType) {
        const self = this;

        return this.getUserByDisplayName(displayName, membershipType, true)
            .then(user => {
                let notification;
                let messages = [];

                const notificationKey = Object.keys(notificationTypes).find(key => notificationTypes[key] === notificationType);
                if (notificationKey) {
                    notification = user.notifications.find(
                        notification => notification.type === notificationType);
					if (!notification) {
						notification = {
							enabled: false,
							type: notificationType,
							messages
						};
						user.notifications.push(notification);
					} else if (!notification.messages) {
						notification.messages = [];
					}
					messages = notification.messages;
                } else {
                    if (!user.messages) {
                        user.messages = [];
                    }
                    messages = user.messages;
                }

                message.DateTime = new Date().toISOString();
                messages.push(message);

                return self.documents.upsertDocument(collectionId, user)
                    .then(() => undefined);
            });
    }

    /**
     * Create an anonymous user.
     * @param user
     * @returns {*}
     */
    createAnonymousUser(user) {
        const self = this;

        const validateUser = validator(anonymousUserSchema, {
            greedy: true
        });

        if (!validateUser(user)) {
            return Promise.reject(Error(JSON.stringify(validateUser.errors)));
        }

        return this.getUserByDisplayName(user.displayName, user.membershipType)
            .then(document => {
                if (document) {
                    Object.assign(document, user);
                    return self.documents.upsertDocument(collectionId, document);
                }

                return self.documents.createDocument(collectionId, user);
            });
    }

    /**
     * Create a user.
     * @param user {Object}
     * @returns {*}
     */
    createUser(user) {
        const errors = [];
        const validateNotifications = validator(notificationSchema);
        const validateUser = validator(userSchema);

        if (!validateUser(user)) {
            return Promise.reject(new Error(JSON.stringify(validateUser.errors)));
        }

        for (let notification of user.notifications) {
            if (!validateNotifications(notification)) {
                _.union(errors, validateNotifications.errors);
            }
        }

        if (errors.length) {
            return Promise.reject(new Error(JSON.stringify(errors)));
        }

        return this.getUserByPhoneNumber(user.phoneNumber)
            .then(existingUser => {
                if (existingUser) {
                    return Promise.reject(new Error('The phone number, ' +
                        user.phoneNumber + ', is already registered.'));
                }

                return this.getUserByEmailAddress(user.emailAddress);
            })
            .then(existingUser => {
                if (existingUser) {
                    return Promise.reject(new Error('The email address, ' +
                        user.emailAddress + ', is already registered.'));
                }

                return this.getUserByDisplayName(user.displayName, user.membershipType);
            })
            .then(existingUser => {
                return this.getPhoneNumberType(user.phoneNumber)
                    .then(carrier => {
                        const filter = validator.filter(userSchema);
                        let filteredUser;

                        user.carrier = carrier.name;
                        user.type = carrier.type;
                        userSchema.additionalProperties = false;
                        filteredUser = filter(user);
                        _.defaults(filteredUser, defaults(userSchema));
                        _.extend(existingUser, filteredUser);

                        return this.documents.upsertDocument(collectionId, existingUser);
                    });
            });
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
                type: 'carrier'
            }, function (err, number) {
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
    getSubscribedUsers(notificationType) {
        const qb = new QueryBuilder();

        if (!notificationTypes[notificationType]) {
            return Promise.reject(Error('notificationType is not valid'));
        }
        qb
            .select('displayName')
            .select('membershipType')
            .select('phoneNumber')
            .from(collectionId)
            .join('notifications')
            .where('type', notificationTypes[notificationType])
            .where('enabled', true);

        return this.documents.getDocuments(collectionId, qb.getQuery(), {
            enableCrossPartitionQuery: true
        });
    }

    /**
     * Get user from display name (gamer tag) and membership type (console).
     * @param displayName
     * @param membershipType
     * @returns {Promise}
     */
    getUserByDisplayName(displayName, membershipType, noCache) {
        const qb = new QueryBuilder();

        if (typeof displayName !== 'string' || _.isEmpty(displayName)) {
            return Promise.reject(new Error('displayName string is required'));
        }
        if (!membershipType || !_.isNumber(membershipType)) {
            return Promise.reject(new Error('membershipType number is required'));
        }

        qb.where('displayName', displayName);
        qb.where('membershipType', membershipType);

        return this.cacheService.getUser(displayName, membershipType)
            .then(user => {
				if (!noCache && user) {
					return user;
                } else {
                    return this.documents.getDocuments(collectionId, qb.getQuery())
                        .then(documents => {
                            if (documents) {
                                if (documents.length > 1) {
                                    throw new Error('more than 1 document found for displayName ' +
                                        displayName + ' and membershipType ' + membershipType);
                                }

                                return documents[0];
                            }

                            throw new Error('documents undefined');
                        });
                }
            });
    }

    /**
     * Get user from email address.
     * @param emailAddress
     * @param membershipType
     * @returns {Promise}
     */
    getUserByEmailAddress(emailAddress) {
        const qb = new QueryBuilder();

        if (typeof emailAddress !== 'string' || _.isEmpty(emailAddress)) {
            return Promise.reject(new Error('emailAddress string is required'));
        }

        qb.where('emailAddress', emailAddress);

        return this.documents.getDocuments(collectionId, qb.getQuery(), {
            enableCrossPartitionQuery: true
        })
            .then(documents => {
                if (documents) {
                    if (documents.length > 1) {
                        throw new Error('more than 1 document found for emailAddress ' + emailAddress);
                    }

                    return documents[0];
                }

                throw new Error('documents undefined');
            });
    }

    /**
     * Get user from their email address token.
     * @param emailAddressToken
     * @returns {Promise}
     */
    getUserByEmailAddressToken(emailAddressToken) {
        const qb = new QueryBuilder();

        if (typeof emailAddressToken !== 'string' || _.isEmpty(emailAddressToken)) {
            return Promise.reject(new Error('emailAddressToken string is required.'));
        }

        qb.where('membership.tokens.blob', emailAddressToken);

        return this.documents.getDocuments(collectionId, qb.getQuery(), {
            enableCrossPartitionQuery: true
        })
            .then(documents => {
                if (documents) {
                    if (documents.length > 1) {
                        throw new Error('more than 1 document found for emailAddressToken ' + emailAddressToken);
                    }

                    return documents[0];
                }

                throw new Error('documents undefined');
            });
    }

	/**
	 * Get user from id.
	 * @param userId
	 * @returns {Promise}
	 */
	getUserById(userId) {
		const qb = new QueryBuilder();

		if (typeof userId !== 'string' || _.isEmpty(userId)) {
			return Promise.reject(new Error('userId string is required'));
		}

		qb.where('id', userId);

        return this.documents.getDocuments(collectionId, qb.getQuery())
            .then(documents => {
                if (documents) {
                    if (documents.length > 1) {
                        throw new Error('more than 1 document found for userId ' + userId);
                    }

                    return documents[0];
                }

                throw new Error('documents undefined');
            });
	}

	/**
     * Get user from membership Id.
     * @param membershipId
     * @returns {Promise}
     */
    getUserByMembershipId(membershipId) {
        const qb = new QueryBuilder();

        if (typeof membershipId !== 'string' || _.isEmpty(membershipId)) {
            return Promise.reject(new Error('membershipId string is required'));
        }

        qb.where('membershipId', membershipId);

        return this.documents.getDocuments(collectionId, qb.getQuery(), {
            enableCrossPartitionQuery: true
        })
            .then(documents => {
                if (documents) {
                    if (documents.length > 1) {
                        throw new Error('more than 1 document found for membershipId ' + membershipId);
                    }

                    return documents[0];
                }

                throw new Error('documents undefined');
            });
    }

    /**
     * Get user from phone number.
     * @param phoneNumber
     * @returns {Promise}
     */
    getUserByPhoneNumber(phoneNumber) {
        const qb = new QueryBuilder();

        if (typeof phoneNumber !== 'string' || _.isEmpty(phoneNumber)) {
            return Promise.reject(Error('phoneNumber string is required'));
        }

        return this.cacheService.getUser(phoneNumber)
            .then(user => {
                if (user) {
                    return user;
                } else {
                    qb.where('phoneNumber', phoneNumber);
                    return this.documents.getDocuments(collectionId, qb.getQuery(), {
                        enableCrossPartitionQuery: true
                    })
                        .then(documents => {
                            if (documents) {
                                if (documents.length > 1) {
                                    throw new Error('more than 1 document found for phoneNumber ' + phoneNumber);
                                }

                                return documents[0];
                            }

                            throw new Error('documents undefined');
                        });
                }
            });
    }

    /**
     * Get user from phone number token.
     * @param phoneNumberToken
     * @returns {Promise}
     */
    getUserByPhoneNumberToken(phoneNumberToken) {
        const qb = new QueryBuilder();

        if (typeof phoneNumberToken !== 'number' || _.isEmpty(phoneNumberToken)) {
            return Promise.reject(Error('phoneNumberToken number is required.'));
        }

        qb.where('membership.tokens.code', phoneNumberToken);

        return this.documents.getDocuments(collectionId, qb.getQuery(), {
            enableCrossPartitionQuery: true
        })
            .then(documents => {
                if (documents) {
                    if (documents.length > 1) {
                        throw new Error('more than 1 document found for phoneNumberToken ' + phoneNumberToken);
                    }

                    return documents[0];
                }

                throw new Error('documents undefined');
            });
    }

    /**
     * Update anonymous user.
     * @param anonymousUser {Object}
     * @returns {Promise}
     */
    updateAnonymousUser(anonymousUser) {
        const validate = validator(anonymousUserSchema);

        if (!validate(anonymousUser)) {
            return Promise.reject(new Error(JSON.stringify(validate.errors)));
        }

        return this.getUserByDisplayName(anonymousUser.displayName, anonymousUser.membershipType)
            .then(user => {
                if (user) {
                    return this.documents.upsertDocument(collectionId, anonymousUser)
                        .then(() => undefined);
                } else {
                    throw new Error('user not found ' + JSON.stringify(anonymousUser));
                }
            });
    }

    /**
     * Update user.
     * @param user {Object}
     * @returns {Promise}
     */
    updateUser(user) {
        const validate = validator(userSchema);

        if (!validate(user)) {
            return Promise.reject(Error(JSON.stringify(validate.errors)));
        }

        return this.getUserByDisplayName(user.displayName, user.membershipType)
            .then(userDocument => {
                Object.assign(userDocument, user);

                return this.documents.upsertDocument(collectionId, userDocument)
                    .then(() => undefined);
            });
    }

	/**
	 * Replace the Bungie authentication information.
	 * @param userId
	 * @param bungie
	 * @returns {Promise}
	 */
	updateUserBungie(userId, bungie) {
        return this.getUserById(userId)
            .then(userDocument => {
				userDocument.bungie = bungie;

				return this.documents.upsertDocument(collectionId, userDocument)
					.then(() => undefined);
			});
	}
}

module.exports = UserService;
