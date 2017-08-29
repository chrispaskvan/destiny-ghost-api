/**
 * A module for managing users.
 *
 * @module User
 * @author Chris Paskvan
 * @requires _
 * @requires fs
 * @requires Q
 * @requires twilio
 * @requires validator
 */
'use strict';
const _ = require('underscore'),
    QueryBuilder = require('../helpers/queryBuilder'),
    defaults = require('json-schema-defaults'),
    notificationTypes = require('../notifications/notification.types'),
    twilio = require('twilio'),
    validator = require('is-my-json-valid');

/**
 * Users Table Name
 * @type {string}
 */
const collectionId = 'Users';
/**
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

class Users {
    /**
     * @constructor
     */
    constructor(cacheService, documentService) {
        this.cacheService = cacheService;
        this.documents = documentService;
    }
    /**
     * Add Message to the User History
     * @param displayName
     * @param membershipType
     * @param message
     * @param notificationType
     * @returns {Request|Promise.<T>|*}
     */
    addUserMessage(displayName, membershipType, message, notificationType) {
        const self = this;

        return this.getUserByDisplayName(displayName, membershipType)
            .then(function (user) {
                let notification;
                let messages;

                if (notificationTypes[notificationType]) {
                    notification = _.find(user.notifications, function (notification) {
                        return notification.type === notificationTypes[notificationType];
                    });
                    if (notification) {
                        messages = notification.messages;
                    }
                } else {
                    messages = user.messages;
                }
                if (messages) {
                    messages.push(message);
                }

                return self.documents.upsertDocument(collectionId, user);
            });
    }
    /**
     * Create an Anonymous User
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
            .then(function (document) {
                if (document) {
                    _.extend(document, user);
                    return self.documents.upsertDocument(collectionId, document);
                }

                return self.documents.createDocument(collectionId, user);
            });
    }
    /**
     * Create a User
     * @param user {Object}
     * @returns {*}
     */
    createUser(user) {
        const self = this;

        const errors = [];
        const validateNotifications = validator(notificationSchema);
        const validateUser = validator(userSchema);

        if (!validateUser(user)) {
            return Promise.reject(new Error(JSON.stringify(validateUser.errors)));
        }
        _.each(user.notifications, function (notification) {
            if (!validateNotifications(notification)) {
                _.union(errors, validateNotifications.errors);
            }
        });
        if (errors.length) {
            return Promise.reject(new Error(JSON.stringify(errors)));
        }

        return this.getUserByPhoneNumber(user.phoneNumber)
            .then(function (existingUser) {
                if (existingUser) {
                    return Promise.reject(new Error('The phone number, ' +
                        user.phoneNumber + ', is already registered.'));
                }
                return self.getUserByEmailAddress(user.emailAddress);
            })
            .then(function (existingUser) {
                if (existingUser) {
                    return Promise.reject(new Error('The email address, ' +
                        user.emailAddress + ', is already registered.'));
                }
                return self.getUserByDisplayName(user.displayName, user.membershipType);
            })
            .then(function (existingUser) {
                self.getPhoneNumberType(user.phoneNumber)
                    .then(function (carrier) {
                        const filter = validator.filter(userSchema);
                        let filteredUser;

                        user.carrier = carrier.name;
                        user.type = carrier.type;
                        userSchema.additionalProperties = false;
                        filteredUser = filter(user);
                        _.defaults(filteredUser, defaults(userSchema));
                        _.extend(existingUser, filteredUser);

                        return self.documents.upsertDocument(collectionId, document);
                    });
            });
    }
    /**
     * Get the carrier data for the provided phone number.
     * @param phoneNumber
     * @returns {*|Object}
     */
    getPhoneNumberType(phoneNumber) {
        const client = new twilio.LookupsClient(this.settings.accountSid, this.settings.authToken);

        return new Promise(function (resolve) {
            client.phoneNumbers(phoneNumber).get({
                countryCode: 'US',
                type: 'carrier'
            }, function (error, number) {
                if (error) {
                    resolve(error);
                } else {
                    resolve(number.carrier);
                }
            });
        });
    }
    /**
     * Get subscribed users from the database.
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
     * Get User with Matching Display Name
     * @param displayName
     * @param membershipType
     * @returns {Promise}
     */
    getUserByDisplayName(displayName, membershipType) {
        const self = this;

        const qb = new QueryBuilder();

        if (typeof displayName !== 'string' || _.isEmpty(displayName)) {
            return Promise.reject(new Error('displayName string is required.'));
        }

        qb.where('displayName', displayName);
        if (membershipType && _.isNumber(membershipType)) { // ToDo Remove this and require membershipType?
            qb.where('membershipType', membershipType);
        }

        return self.cacheService.getUser(displayName, membershipType)
            .then(function (user) {
                if (user) {
                    return user;
                } else {
                    return self.documents.getDocuments(collectionId, qb.getQuery(), membershipType ? undefined : {
                        enableCrossPartitionQuery: true
                    })
                        .then(function (documents) {
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
     * Get User By Email Address
     * @param emailAddress
     * @param membershipType
     * @returns {Promise}
     */
    getUserByEmailAddress(emailAddress, membershipType) {
        const self = this;

        const qb = new QueryBuilder();

        if (typeof emailAddress !== 'string' || _.isEmpty(emailAddress)) {
            return Promise.reject(new Error('emailAddress string is required'));
        }
        if (!(membershipType && _.isNumber(membershipType))) {
            return Promise.reject(new Error('membershipType number is required'));
        }

        return new Promise(function (resolve, reject) {
            qb.where('membershipType', membershipType);
            qb.where('emailAddress', emailAddress);

            self.documents.getDocuments(collectionId, qb.getQuery(), {
                enableCrossPartitionQuery: true
            })
                .then(function (documents) {
                    if (documents) {
                        if (documents.length > 1) {
                            reject(new Error('more than 1 document found for emailAddress ' + emailAddress));
                        }

                        resolve(documents[0]);
                    }

                    reject(new Error('documents undefined'));
                });
        });
    }
    /**
     * Get the user token by the email address token.
     * @param emailAddressToken
     * @returns {Promise}
     */
    getUserByEmailAddressToken(emailAddressToken) {
        const self = this;

        const qb = new QueryBuilder();

        if (typeof emailAddressToken !== 'string' || _.isEmpty(emailAddressToken)) {
            return Promise.reject(new Error('emailAddressToken string is required.'));
        }

        return new Promise(function (resolve, reject) {
            qb.where('membership.tokens.blob', emailAddressToken);

            self.documents.getDocuments(collectionId, qb.getQuery(), {
                enableCrossPartitionQuery: true
            })
                .then(function (documents) {
                    if (documents) {
                        if (documents.length > 1) {
                            reject(new Error('more than 1 document found for emailAddressToken ' + emailAddressToken));
                        }

                        resolve(documents[0]);
                    }

                    reject(new Error('documents undefined'));
                });
        });
    }
    /**
     * Get User By Membership Id
     * @param membershipId
     * @returns {Promise}
     */
    getUserByMembershipId(membershipId) {
        const self = this;

        const qb = new QueryBuilder();

        if (typeof membershipId !== 'string' || _.isEmpty(membershipId)) {
            return Promise.reject(new Error('membershipId string is required'));
        }

        return new Promise(function (resolve, reject) {
            qb.where('membershipId', membershipId);

            self.documents.getDocuments(collectionId, qb.getQuery(), {
                enableCrossPartitionQuery: true
            })
                .then(function (documents) {
                    if (documents) {
                        if (documents.length > 1) {
                            reject(new Error('more than 1 document found for membershipId ' + membershipId));
                        }

                        resolve(documents[0]);
                    }

                    reject(new Error('documents undefined'));
                });
        });
    }
    /**
     * Get User By Phone Number
     * @param phoneNumber
     * @returns {Promise}
     */
    getUserByPhoneNumber(phoneNumber) {
        const self = this;

        const qb = new QueryBuilder();

        if (typeof phoneNumber !== 'string' || _.isEmpty(phoneNumber)) {
            return Promise.reject(Error('phoneNumber string is required.'));
        }

        return self.cacheService.getUser(phoneNumber)
            .then(function (user) {
                if (user) {
                    return user;
                } else {
                    qb.where('phoneNumber', phoneNumber);
                    return self.documents.getDocuments(collectionId, qb.getQuery(), {
                        enableCrossPartitionQuery: true
                    })
                        .then(function (documents) {
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
     * Get User By Phone Number Token
     * @param phoneNumberToken
     * @returns {Promise}
     */
    getUserByPhoneNumberToken(phoneNumberToken) {
        const self = this;

        const qb = new QueryBuilder();

        if (typeof phoneNumberToken !== 'number' || _.isEmpty(phoneNumberToken)) {
            return Promise.reject(Error('phoneNumberToken number is required.'));
        }

        return new Promise(function (resolve, reject) {
            qb.where('membership.tokens.code', phoneNumberToken);

            self.documents.getDocuments(collectionId, qb.getQuery(), {
                enableCrossPartitionQuery: true
            })
                .then(function (documents) {
                    if (documents) {
                        if (documents.length > 1) {
                            reject(new Error('more than 1 document found for phoneNumberToken ' + phoneNumberToken));
                        }

                        resolve(documents[0]);
                    }

                    reject(new Error('documents undefined'));
                });
        });
    }
    /**
     * Update Anonymous User
     * @param user {Object}
     * @returns {Promise}
     */
    updateAnonymousUser(user) {
        const self = this;

        const validate = validator(anonymousUserSchema);

        if (!validate(user)) {
            return Promise.reject(new Error(JSON.stringify(validate.errors)));
        }

        return new Promise(function (resolve, reject) {
            self.getUserByDisplayName(user.displayName, user.membershipType)
                .then(function (user1) {
                    if (user1) {
                        self.documents.upsertDocument(collectionId, user, function (err) {
                            if (err) {
                                reject(err);
                            }

                            resolve();
                        });
                    } else {
                        reject(new Error('User not found: ' + JSON.stringify(user)));
                    }
                });
        });
    }
    /**
     * Update User
     * @param user {Object}
     * @returns {Promise}
     */
    updateUser(user) {
        const self = this;

        const validate = validator(userSchema);

        if (!validate(user)) {
            return Promise.reject(Error(JSON.stringify(validate.errors)));
        }

        return new Promise(function (resolve, reject) {
            self.getUserByDisplayName(user.displayName, user.membershipType)
                .then(function (userDocument) {
                    _.extend(userDocument, user);
                    self.documents.upsertDocument(collectionId, userDocument, function (err) {
                        if (err) {
                            reject(err);
                        }

                        resolve();
                    });
                });
        });
    }
}
exports = module.exports = Users;
