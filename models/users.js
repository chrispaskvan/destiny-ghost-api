/**
 * A module for managing users.
 *
 * @module User
 * @author Chris Paskvan
 * @requires _
 * @requires fs
 * @requires Horseman
 * @requires Q
 * @requires sqlite3
 * @requires twilio
 * @requires validator
 */
var _ = require('underscore'),
    defaults = require('json-schema-defaults'),
    fs = require('fs'),
    Q = require('q'),
    sqlite3 = require('sqlite3'),
    twilio = require('twilio'),
    validator = require('is-my-json-valid');
/**
 *
 * @param databaseFullPath {string}
 * @param twilioSettingsFullPath {string}
 * @constructor
 */
function Users(databaseFullPath, twilioSettingsFullPath) {
    'use strict';
    /**
     * @member - Full path of the local database.
     * @type {*|string}
     * @public
     */
    this.databaseFullPath = databaseFullPath || './databases/ghost.db';
    if (!fs.existsSync(this.databaseFullPath)) {
        /**
         * @todo
         */
        console.log('Creating database file.');
        fs.openSync(this.databaseFullPath, 'w');
    }
    /**
     * @type {sqlite3.Database}
     */
    var db = new sqlite3.Database(this.databaseFullPath);
    /**
     * @description Lazy method for preventing database locks.
     */
    db.configure('busyTimeout', 5000);
    db.serialize(function () {
        db.run('CREATE TABLE IF NOT EXISTS DestinyGhostUser(id TEXT, json BLOB)');
        db.run('CREATE TABLE IF NOT EXISTS DestinyGhostUserMessage(id TEXT, json BLOB)');
        db.run('CREATE TABLE IF NOT EXISTS DestinyGhostUserToken(id TEXT, json BLOB)');
    });
    this.db = db;
    /**
     * @member {Object}
     * @type {{accountSid: string, authToken string, phoneNumber string}} settings
     */
    this.settings = JSON.parse(fs.readFileSync(twilioSettingsFullPath || './settings/twilio.production.json'));
}
/**
 * @namespace
 * @type {{actions, cleanPhoneNumber, createUser, createUserMessage, createUserToken, deleteExpiredUserTokens,
 * deleteUser, getBlob, getLastNotificationDate, getPhoneNumberType, getSubscribedUsers, getUserByEmailAddress,
 * getUserByGamerTag, getUserByPhoneNumber, getUserTokenByEmailAddressToken, getUserTokenByPhoneNumber,
 * getUserTokenByPhoneNumberToken, updateUser}}
 */
Users.prototype = (function () {
    'use strict';
    /**
     * @private
     */
    var userSchema = {
        name: 'User',
        type: 'object',
        properties: {
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
            gamerTag: {
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
            notifications: {
                required: true,
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
            carrier: {
                readOnly: true,
                type: 'string'
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
            name: {
                required: true,
                type: 'string'
            },
            enabled: {
                required: true,
                type: 'boolean'
            }
        },
        additionalProperties: false
    };
    /**
     * Allowed Actions
     * @type {{Gunsmith: string, Xur: string}}
     */
    var actions = {
        Foundry: 'Orders',
        Gunsmith: 'Banshee-44',
        IronBanner: 'Lord Saladin',
        Xur: 'Xur'
    };
    /**
     * Get the phone number format into the Twilio standard.
     * @param phoneNumber
     * @returns {string}
     * @private
     */
    var cleanPhoneNumber = function (phoneNumber) {
        var cleaned = phoneNumber.replace(/\D/g, '');
        return '+1' + cleaned;
    };
    /**
     * Create the user in the database.
     * @param user {Object}
     * @param callback
     */
    var createUser = function (user, callback) {
        var self = this;
        var deferred = Q.defer();
        var validateUser = validator(userSchema);
        if (!validateUser(user)) {
            deferred.reject(new Error(JSON.stringify(validateUser.errors)));
            return deferred.promise.nodeify(callback);
        }
        var validateNotifications = validator(notificationSchema);
        if (!validateNotifications(user.notifications)) {
            deferred.reject(new Error(JSON.stringify(validateNotifications.errors)));
            return deferred.promise.nodeify(callback);
        }
        this.getUserByPhoneNumber(user.phoneNumber)
            .then(function (existingUser) {
                if (existingUser) {
                    deferred.reject(new Error('The phone number, ' + user.phoneNumber + ', is already registered.'));
                    return deferred.promise.nodeify(callback);
                }
                return self.getUserByGamerTag(user.gamerTag, user.membershipType);
            })
            .then(function (existingUser) {
                if (existingUser) {
                    deferred.reject(new Error('The gamer tag, ' + user.gamerTag + ', is already registered.'));
                    return deferred.promise.nodeify(callback);
                }
                return self.getUserByEmailAddress(user.emailAddress);
            })
            .then(function (existingUser) {
                if (existingUser) {
                    deferred.reject(new Error('The email address, ' + user.emailAddress + ', is already registered.'));
                    return deferred.promise.nodeify(callback);
                }
                self.getPhoneNumberType(user.phoneNumber)
                    .then(function (carrier) {
                        user.carrier = carrier.name;
                        user.dateRegistered = new Date().toISOString();
                        user.type = carrier.type;
                        userSchema.additionalProperties = false;
                        var filter = validator.filter(userSchema);
                        var filteredUser = filter(user);
                        _.defaults(filteredUser, defaults(userSchema));
                        var sql = self.db.prepare('INSERT INTO DestinyGhostUser VALUES (?, ?)');
                        sql.run(user.phoneNumber, JSON.stringify(filteredUser));
                        sql.finalize();
                        deferred.resolve();
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
    var createUserMessage = function (user, message, action) {
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
     *
     * @param user
     * @param callback
     * @returns {*}
     */
    var createUserToken = function (user, callback) {
        var deferred = Q.defer();
        var validate = validator(userSchema);
        if (!validate(user)) {
            deferred.reject(new Error(JSON.stringify(validate.errors)));
            return deferred.promise.nodeify(callback);
        }
        var sql = this.db.prepare('INSERT INTO DestinyGhostUserToken VALUES (?, ?)');
        sql.run(new Date().toISOString(), JSON.stringify(user));
        sql.finalize();
        deferred.resolve();
        return deferred.promise.nodeify(callback);
    };
    /**
     * Delete expired tokens.
     */
    var deleteExpiredUserTokens = function () {
        var now = new Date((new Date()) - 1000 * 3600 * 2);
        var sql = this.db.prepare('DELETE FROM DestinyGhostUserToken WHERE id < \'' + now.toISOString() + '\'');
        sql.run();
        sql.finalize();
    };
    /**
     * Delete a user.
     * @param phoneNumber {string}
     */
    var deleteUser = function (phoneNumber) {
        var sql = this.db.prepare('DELETE FROM DestinyGhostUser WHERE id = \'' + phoneNumber + '\'');
        sql.run();
        sql.finalize();
    };
    /**
     *
     * @param numberOfBytes
     * @returns {*|promise}
     */
    var getBlob = function (numberOfBytes) {
        var deferred = Q.defer();
        this.db.each('SELECT lower(hex(randomblob(' + (numberOfBytes || 16).toString() +
            '))) AS id', function (err, row) {
                if (err) {
                    deferred.reject(err);
                } else {
                    deferred.resolve(row.id);
                }
            }, function (err) {
                if (err) {
                    deferred.reject(err);
                } else {
                    deferred.resolve();
                }
            });
        return deferred.promise;
    };
    /**
     *
     * @param phoneNumber
     * @param action
     * @param callback
     * @returns {*}
     */
    var getLastNotificationDate = function (phoneNumber, action, callback) {
        var deferred = Q.defer();
        if (!_.contains(_.values(actions), action)) {
            deferred.reject(new Error(action.toString() + ' is an unknown action.'));
            return deferred.promise.nodeify(callback);
        }
        this.db.each('SELECT id FROM DestinyGhostUserMessage WHERE json LIKE \'%"phoneNumber":"' +
            phoneNumber + '"%\' AND json LIKE \'%"action":"' +
            action.toString() + '"%\' ORDER BY id DESC LIMIT 1', function (err, row) {
                if (err) {
                    deferred.reject(err);
                } else {
                    deferred.resolve(new Date(row.id));
                }
            }, function (err) {
                if (err) {
                    deferred.reject(err);
                } else {
                    deferred.resolve();
                }
            });
        return deferred.promise.nodeify(callback);
    };
    /**
     * Get the carrier data for the provided phone number.
     * @param phoneNumber
     * @returns {*|Object}
     */
    var getPhoneNumberType = function (phoneNumber) {
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
    var getSubscribedUsers = function () {
        var deferred = Q.defer();
        var users = [];
        this.db.each('SELECT json FROM DestinyGhostUser', function (err, row) {
            if (err) {
                deferred.reject(err);
            } else {
                var user = JSON.parse(row.json);
                if (user.isSubscribedToBanshee44 || user.isSubscribedToXur) {
                    users.push(user);
                }
            }
        }, function (err) {
            if (err) {
                deferred.reject(err);
            } else {
                deferred.resolve(users);
            }
        });
        return deferred.promise;
    };
    /**
     * Get the user with the provided email address.
     * @param emailAddress {string}
     * @returns {*|Object}
     */
    var getUserByEmailAddress = function (emailAddress) {
        var deferred = Q.defer();
        this.db.all('SELECT json FROM DestinyGhostUser WHERE json LIKE \'%"emailAddress":"' +
            emailAddress + '"%\'', function (err, rows) {
                if (err) {
                    deferred.reject(err);
                } else {
                    if (rows.length === 0) {
                        deferred.resolve();
                    } else {
                        if (rows.length === 1) {
                            deferred.resolve(JSON.parse(_.first(rows).json));
                        } else {
                            deferred.reject(new Error('The email address, ' + emailAddress + ', is not unique.'));
                        }
                    }
                }
            });
        return deferred.promise;
    };
    /**
     * Get the user by the gamer tag.
     * @param gamerTag {string}
     * @param membershipType {integer}
     * @returns {*|Object}
     */
    var getUserByGamerTag = function (gamerTag, membershipType) {
        var deferred = Q.defer();
        this.db.all('SELECT json FROM DestinyGhostUser WHERE json LIKE \'%"gamerTag":"' +
            gamerTag + '"%\'', function (err, rows) {
                if (err) {
                    deferred.reject(err);
                } else {
                    if (rows.length === 0) {
                        deferred.resolve();
                    } else {
                        var userRows = _.filter(rows, function (row) {
                            return JSON.parse(row.json).membershipType === membershipType;
                        });
                        if (userRows.length === 1) {
                            deferred.resolve(JSON.parse(userRows[0].json));
                        } else {
                            deferred.reject(new Error('The gamer tag, ' + gamerTag + ', is not unique.'));
                        }
                    }
                }
            });
        return deferred.promise;
    };
    /**
     * Get the user by the membership Id.
     * @param membershipId
     * @returns {*|Object}
     */
    var getUserByMembershipId = function (membershipId) {
        var deferred = Q.defer();
        this.db.all('SELECT json FROM DestinyGhostUser WHERE json LIKE \'%"membershipId":"' +
            membershipId + '"%\'', function (err, rows) {
                if (err) {
                    deferred.reject(err);
                } else {
                    if (rows.length === 0) {
                        deferred.resolve();
                    } else {
                        if (rows.length === 1) {
                            deferred.resolve(JSON.parse(_.first(rows).json));
                        } else {
                            deferred.reject(new Error('The membership Id, ' + membershipId + ', is not unique.'));
                        }
                    }
                }
            });
        return deferred.promise;
    };
    /**
     * Get the user by the phone number.
     * @param phoneNumber
     * @returns {*|Object}
     */
    var getUserByPhoneNumber = function (phoneNumber) {
        var deferred = Q.defer();
        this.db.all('SELECT json FROM DestinyGhostUser WHERE json LIKE \'%"phoneNumber":"' +
            phoneNumber + '"%\'', function (err, rows) {
                if (err) {
                    deferred.reject(err);
                } else {
                    if (rows.length === 0) {
                        deferred.resolve();
                    } else {
                        if (rows.length === 1) {
                            deferred.resolve(JSON.parse(_.first(rows).json));
                        } else {
                            deferred.reject(new Error('The phone number, ' + phoneNumber + ', is not unique.'));
                        }
                    }
                }
            });
        return deferred.promise;
    };
    /**
     * Get the user token by the email address token.
     * @param emailAddressToken
     * @returns {*|promise}
     */
    var getUserTokenByEmailAddressToken = function (emailAddressToken) {
        return deleteExpiredUserTokens()
            .then(function () {
                var deferred = Q.defer();
                this.db.each('SELECT id, json FROM DestinyGhostUserToken WHERE json LIKE \'%"emailAddress":"' +
                    emailAddressToken + '"%\' ORDER BY id DESC LIMIT 1', function (err, row) {
                        if (err) {
                            deferred.reject(err);
                        } else {
                            var user = JSON.parse(row.json);
                            user.timeStamp = new Date(row.id);
                            deferred.resolve(user);
                        }
                    }, function (err, rows) {
                        if (err) {
                            deferred.reject(err);
                        } else {
                            if (rows === 0) {
                                deferred.resolve();
                            }
                        }
                    });
                return deferred.promise;
            });
    };
    /**
     * Get the user token by the phone number.
     * @param phoneNumber
     * @returns {*|Object}
     */
    var getUserTokenByPhoneNumber = function (phoneNumber) {
        return deleteExpiredUserTokens()
            .then(function () {
                var deferred = Q.defer();
                this.db.each('SELECT id, json FROM DestinyGhostUserToken WHERE json LIKE \'%"phoneNumber":"' +
                    phoneNumber + '"%\' ORDER BY id DESC LIMIT 1', function (err, row) {
                        if (err) {
                            deferred.reject(err);
                        } else {
                            var user = JSON.parse(row.json);
                            user.timeStamp = new Date(row.id);
                            deferred.resolve(user);
                        }
                    }, function (err, rows) {
                        if (err) {
                            deferred.reject(err);
                        } else {
                            if (rows === 0) {
                                deferred.resolve();
                            }
                        }
                    });
                return deferred.promise;
            });
    };
    /**
     * Get the user token by the phone number token.
     * @param phoneNumberToken
     * @returns {*|promise}
     */
    var getUserTokenByPhoneNumberToken = function (phoneNumberToken) {
        return deleteExpiredUserTokens()
            .then(function () {
                var deferred = Q.defer();
                this.db.each('SELECT id, json FROM DestinyGhostUserToken WHERE json LIKE \'%"phoneNumber":"' +
                    phoneNumberToken + '"%\' ORDER BY id DESC LIMIT 1', function (err, row) {
                        if (err) {
                            deferred.reject(err);
                        } else {
                            var user = JSON.parse(row.json);
                            user.timeStamp = new Date(row.id);
                            deferred.resolve(user);
                        }
                    }, function (err, rows) {
                        if (err) {
                            deferred.reject(err);
                        } else {
                            if (rows === 0) {
                                deferred.resolve();
                            }
                        }
                    });
                return deferred.promise;
            });
    };
    /**
     * Update the user.
     * @param user {Object}
     * @param callback
     * @returns {*|Array}
     */
    var updateUser = function (user, callback) {
        var deferred = Q.defer();
        var validate = validator(userSchema);
        if (!validate(user)) {
            deferred.reject(new Error(JSON.stringify(validate.errors)));
            return deferred.promise.nodeify(callback);
        }
        /**
         * @todo
         */
        deferred.resolve();
        return deferred.promise.nodeify(callback);
    };
    return {
        actions: actions,
        cleanPhoneNumber: cleanPhoneNumber,
        createUser: createUser,
        createUserMessage: createUserMessage,
        createUserToken: createUserToken,
        deleteExpiredUserTokens: deleteExpiredUserTokens,
        deleteUser: deleteUser,
        getBlob: getBlob,
        getLastNotificationDate: getLastNotificationDate,
        getPhoneNumberType: getPhoneNumberType,
        getSubscribedUsers: getSubscribedUsers,
        getUserByEmailAddress: getUserByEmailAddress,
        getUserByGamerTag: getUserByGamerTag,
        getUserByMembershipId: getUserByMembershipId,
        getUserByPhoneNumber: getUserByPhoneNumber,
        getUserTokenByEmailAddressToken: getUserTokenByEmailAddressToken,
        getUserTokenByPhoneNumber: getUserTokenByPhoneNumber,
        getUserTokenByPhoneNumberToken: getUserTokenByPhoneNumberToken,
        updateUser: updateUser
    };
}());
module.exports = Users;
