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
var _ = require('underscore'),
    defaults = require('json-schema-defaults'),
    fs = require('fs'),
    Q = require('q'),
    QueryBuilder = require('../helpers/queryBuilder'),
    twilio = require('twilio'),
    validator = require('is-my-json-valid');

/**
 * Users Table Name
 * @type {string}
 */
var collectionId = 'Users';
/**
 * @constructor
 */
function Users(cacheService, documentService) {
    this.cacheService = cacheService;
    this.documents = documentService;
}
/**
 * @private
 */
var anonymousUserSchema = {
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
var userSchema = {
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
var notificationSchema = {
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
 * Allowed Actions
 * @type {{Gunsmith: string, Xur: string}}
 */
var notificationTypes = {
    Foundry: 'Orders',
    Gunsmith: 'Banshee-44',
    IronBanner: 'Lord Saladin',
    Xur: 'Xur'
};
/**
 * Create an Anonymous User
 * @param user
 * @param callback
 * @returns {*}
 */
Users.prototype.createAnonymousUser = function (user, callback) {
    var self = this;
    var deferred = Q.defer();
    var validateUser = validator(anonymousUserSchema, {
        greedy: true
    });

    if (!validateUser(user)) {
        deferred.reject(Error(JSON.stringify(validateUser.errors)));
        return deferred.promise.nodeify(callback);
    }

    return this.getUserByDisplayName(user.displayName, user.membershipType)
        .then(function (document) {
            if (document) {
                _.extend(document, user);
                return self.documents.upsertDocument(collectionId, document);
            }

            return self.documents.createDocument(collectionId, user);
        });
};
/**
 * Create the user in the database.
 * @param user {Object}
 * @param callback
 */
Users.prototype.createUser = function (user, callback) {
    var self = this;

    var deferred = Q.defer();
    var errors = [];
    var validateNotifications = validator(notificationSchema);
    var validateUser = validator(userSchema);

    if (!validateUser(user)) {
        deferred.reject(Error(JSON.stringify(validateUser.errors)));
        return deferred.promise.nodeify(callback);
    }
    _.each(user.notifications, function (notification) {
        if (!validateNotifications(notification)) {
            _.union(errors, validateNotifications.errors);
        }
    });
    if (errors.length) {
        deferred.reject(Error(JSON.stringify(errors)));
        return deferred.promise.nodeify(callback);
    }

    this.getUserByPhoneNumber(user.phoneNumber)
        .then(function (existingUser) {
            if (existingUser) {
                return deferred.reject(Error('The phone number, ' +
                    user.phoneNumber + ', is already registered.'));
            }
            return self.getUserByEmailAddress(user.emailAddress);
        })
        .then(function (existingUser) {
            if (existingUser) {
                return deferred.reject(Error('The email address, ' +
                    user.emailAddress + ', is already registered.'));
            }
            return self.getUserByDisplayName(user.displayName, user.membershipType);
        })
        .then(function (existingUser) {
            self.getPhoneNumberType(user.phoneNumber)
                .then(function (carrier) {
                    var filter = validator.filter(userSchema);
                    var filteredUser;

                    user.carrier = carrier.name;
                    user.type = carrier.type;
                    userSchema.additionalProperties = false;
                    filteredUser = filter(user);
                    _.defaults(filteredUser, defaults(userSchema));
                    _.extend(existingUser, filteredUser);

                    return self.documents.upsertDocument(collectionId, document);
                });
        });

    return deferred.promise.nodeify(callback);
};
/**
 * Create an entry in the database for the message sent to the user.
 * @param user {Object}
 * @param message {Object}
 * @param action {string}
 */
Users.prototype.createUserMessage = function (user, message, action) {
    var userMessage = {
        action: action || '',
        phoneNumber: user.phoneNumber,
        sid: message.sid
    };
    var sql = this.db.prepare('INSERT INTO DestinyGhostUserMessage VALUES (?, ?)');
    sql.run(new Date().toISOString(), JSON.stringify(userMessage));
    sql.finalize();
};
/**
 * Get the carrier data for the provided phone number.
 * @param phoneNumber
 * @returns {*|Object}
 */
Users.prototype.getPhoneNumberType = function (phoneNumber) {
    var client = new twilio.LookupsClient(this.settings.accountSid, this.settings.authToken);
    var deferred = Q.defer();

    client.phoneNumbers(phoneNumber).get({
        countryCode: 'US',
        type: 'carrier'
    }, function (error, number) {
        if (error) {
            deferred.resolve(error);
        } else {
            deferred.resolve(number.carrier);
        }
    });

    return deferred.promise;
};
/**
 * Get subscribed users from the database.
 * @returns {*|Array.User}
 */
Users.prototype.getSubscribedUsers = function () {
    var subscribedUsers = [];
    return this.getRegisteredUsers()
        .then(function (registeredUsers) {
            _.each(registeredUsers, function (registeredUser) {
                if (registeredUser.notifications.length > 0) {
                    subscribedUsers.push(registeredUser);
                }
            });
            return subscribedUsers;
        });
};
/**
 * Get User with Matching Display Name
 * @param displayName
 * @param membershipType
 * @param callback
 * @returns {*}
 */
Users.prototype.getUserByDisplayName = function (displayName, membershipType, callback) {
    var self = this;
    var deferred = Q.defer();
    var qb = new QueryBuilder();

    if (typeof displayName !== 'string' || _.isEmpty(displayName)) {
        deferred.reject(Error('displayName string is required.'));

        return deferred.promise.nodeify(callback);
    }
    qb.where('displayName', displayName);
    if (membershipType && _.isNumber(membershipType)) { // ToDo Remove this and require membershipType?
        qb.where('membershipType', membershipType);
    }

    this.cacheService.getUser(displayName, membershipType)
        .then(function (user) {
            if (user) {
                return deferred.resolve(user);
            } else {
                self.documents.getDocuments(collectionId, qb.getQuery(), membershipType ? undefined : {
                        enableCrossPartitionQuery: true })
                    .then(function (documents) {
                        if (documents) {
                            if (documents.length > 1) {
                                return deferred.reject(
                                    Error('more than 1 document found for displayName ' +
                                        displayName + ' and membershipType ' + membershipType));
                            }

                            return deferred.resolve(documents[0]);
                        }

                        return deferred.reject(Error('documents undefined'));
                    });
            }
        });

    return deferred.promise.nodeify(callback);
};
/**
 * Get the user with the provided email address.
 * @param emailAddress {string}
 * @returns {*|Object}
 */
Users.prototype.getUserByEmailAddress = function (emailAddress, callback) {
    var deferred = Q.defer();
    var qb = new QueryBuilder();

    if (typeof emailAddress !== 'string' || _.isEmpty(emailAddress)) {
        deferred.reject(Error('emailAddress string is required'));

        return deferred.promise.nodeify(callback);
    }

    qb.where('emailAddress', emailAddress);
    this.documents.getDocuments(collectionId, qb.getQuery(), {
        enableCrossPartitionQuery: true
    })
        .then(function (documents) {
            if (documents) {
                if (documents.length > 1) {
                    return deferred.reject(
                        Error('more than 1 document found for emailAddress ' + emailAddress));
                }

                return deferred.resolve(documents[0]);
            }

            return deferred.reject(Error('documents undefined'));
        });

    return deferred.promise.nodeify(callback);
};
/**
 * Get the user token by the email address token.
 * @param emailAddressToken
 * @param callback
 * @returns {*|promise}
 */
Users.prototype.getUserByEmailAddressToken = function (emailAddressToken, callback) {
    var deferred = Q.defer();
    var qb = new QueryBuilder();

    if (typeof emailAddressToken !== 'string' || _.isEmpty(emailAddressToken)) {
        deferred.reject(Error('emailAddressToken string is required.'));

        return deferred.promise.nodeify(callback);
    }

    qb.where('membership.tokens.blob', emailAddressToken);

    this.documents.getDocuments(collectionId, qb.getQuery(), {
            enableCrossPartitionQuery: true }, callback)
        .then(function (documents) {
            if (documents) {
                if (documents.length > 1) {
                    return deferred.reject(
                        Error('more than 1 document found for emailAddressToken ' + emailAddressToken));
                }

                return deferred.resolve(documents[0]);
            }

            return deferred.reject(Error('documents undefined'));
        });

    return deferred.promise.nodeify(callback);
};
/**
 * Get the user by the membership Id.
 * @param membershipId
 * @param callback
 * @returns {*|Object}
 */
Users.prototype.getUserByMembershipId = function (membershipId, callback) {
    var deferred = Q.defer();
    var qb = new QueryBuilder();

    if (typeof membershipId !== 'string' || _.isEmpty(membershipId)) {
        deferred.reject(Error('membershipId string is required'));

        return deferred.promise.nodeify(callback);
    }
    qb.where('membershipId', membershipId);

    this.documents.getDocuments(collectionId, qb.getQuery(), {
            enableCrossPartitionQuery: true })
        .then(function (documents) {
            if (documents) {
                if (documents.length > 1) {
                    return deferred.reject(
                        Error('more than 1 document found for membershipId ' + membershipId));
                }

                return deferred.resolve(documents[0]);
            }

            return deferred.reject(Error('documents undefined'));
        });

    return deferred.promise.nodeify(callback);
};
/**
 * Get the user by the phone number.
 * @param phoneNumber
 * @param membershipType
 * @param callback
 * @returns {*|Object}
 */
Users.prototype.getUserByPhoneNumber = function (phoneNumber, callback) {
    var deferred = Q.defer();
    var qb = new QueryBuilder();

    if (typeof phoneNumber !== 'string' || _.isEmpty(phoneNumber)) {
        deferred.reject(Error('phoneNumber string is required.'));

        return deferred.promise.nodeify(callback);
    }

    qb.where('phoneNumber', phoneNumber);
    this.documents.getDocuments(collectionId, qb.getQuery(), {
        enableCrossPartitionQuery: true
    })
        .then(function (documents) {
            if (documents) {
                if (documents.length > 1) {
                    return deferred.reject(
                        Error('more than 1 document found for phoneNumber ' + phoneNumber));
                }

                return deferred.resolve(documents[0]);
            }

            return deferred.reject(Error('documents undefined'));
        });

    return deferred.promise.nodeify(callback);
};
/**
 * Get the user by the phone number token
 * @param phoneNumberToken
 * @param callback
 * @returns {*|promise}
 */
Users.prototype.getUserByPhoneNumberToken = function (phoneNumberToken, callback) {
    var deferred = Q.defer();
    var qb = new QueryBuilder();

    if (typeof phoneNumberToken !== 'number' || _.isEmpty(phoneNumberToken)) {
        deferred.reject(Error('phoneNumberToken number is required.'));

        return deferred.promise.nodeify(callback);
    }
    qb.where('membership.tokens.code', phoneNumberToken);

    this.documents.getDocuments(collectionId, qb.getQuery(), {
            enableCrossPartitionQuery: true })
        .then(function (documents) {
            if (documents) {
                if (documents.length > 1) {
                    return deferred.reject(
                        Error('more than 1 document found for phoneNumberToken ' + phoneNumberToken));
                }

                return deferred.resolve(documents[0]);
            }

            return deferred.reject(Error('documents undefined'));
        });

    return deferred.promise.nodeify(callback);
};
/**
 * Update the user.
 * @param user {Object}
 * @param callback
 * @returns {*|Array}
 */
Users.prototype.updateAnonymousUser = function (user, callback) {
    var self = this;
    var deferred = Q.defer();
    var validate = validator(anonymousUserSchema);
    if (!validate(user)) {
        deferred.reject(Error(JSON.stringify(validate.errors)));
        return deferred.promise.nodeify(callback);
    }
    this.getUserByDisplayName(user.displayName, user.membershipType)
        .then(function (user1) {
            if (user1) {
                self.documents.upsertDocument(collectionId, user, function (err) {
                    if (err) {
                        return deferred.reject(err);
                    }

                    return deferred.resolve();
                });
            } else {
                deferred.reject(Error('User not found: ' + JSON.stringify(user)));
            }
        });
    return deferred.promise.nodeify(callback);
};
/**
 * Update the user.
 * @param user {Object}
 * @param callback
 * @returns {*|Array}
 */
Users.prototype.updateUser = function (user, callback) {
    var self = this;
    var deferred = Q.defer();
    var validate = validator(userSchema);

    if (!validate(user)) {
        deferred.reject(Error(JSON.stringify(validate.errors)));
        return deferred.promise.nodeify(callback);
    }

    this.getUserByDisplayName(user.displayName, user.membershipType)
        .then(function (userDocument) {
            _.extend(userDocument, user);
            self.documents.upsertDocument(collectionId, userDocument, function (err) {
                if (err) {
                    return deferred.reject(err);
                }

                return deferred.resolve();
            });
        });

    return deferred.promise.nodeify(callback);
};

exports = module.exports = Users;
