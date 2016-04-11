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
var Users = function (databaseFullPath, twilioSettingsFullPath) {
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
    /**
     * @private
     */
    var schema = {
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
            isSubscribedToBanshee44: {
                default: true,
                type: 'boolean'
            },
            isSubscribedToFoundryOrders: {
                default: true,
                type: 'boolean'
            },
            isSubscribedToLordSaladin: {
                default: true,
                type: 'boolean'
            },
            isSubscribedToXur: {
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
    /**
     * @member {Object}
     * @type {{accountSid: string, authToken string, phoneNumber string}} settings
     */
    var settings = JSON.parse(fs.readFileSync(twilioSettingsFullPath || './settings/twilio.production.json'));
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
        var deferred = Q.defer();
        var validate = validator(schema);
        if (!validate(user)) {
            deferred.reject(new Error(JSON.stringify(validate.errors)));
            return deferred.promise.nodeify(callback);
        }
        getUserByPhoneNumber(user.phoneNumber)
            .then(function (existingUser) {
                if (existingUser) {
                    deferred.reject(new Error('The phone number, ' + user.phoneNumber + ', is already registered.'));
                    return deferred.promise.nodeify(callback);
                }
                return getUserByGamerTag(user.gamerTag);
            })
            .then(function (existingUser) {
                if (existingUser) {
                    deferred.reject(new Error('The gamer tag, ' + user.gamerTag + ', is already registered.'));
                    return deferred.promise.nodeify(callback);
                }
                return getUserByEmailAddress(user.emailAddress);
            })
            .then(function (existingUser) {
                if (existingUser) {
                    deferred.reject(new Error('The email address, ' + user.emailAddress + ', is already registered.'));
                    return deferred.promise.nodeify(callback);
                }
                getPhoneNumberType(user.phoneNumber)
                    .then(function (carrier) {
                        user.carrier = carrier.name;
                        user.dateRegistered = new Date().toISOString();
                        user.type = carrier.type;
                        schema.additionalProperties = false;
                        var filter = validator.filter(schema);
                        var filteredUser = filter(user);
                        _.defaults(filteredUser, defaults(schema));
                        var sql = db.prepare('INSERT INTO DestinyGhostUser VALUES (?, ?)');
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
        var sql = db.prepare('INSERT INTO DestinyGhostUserMessage VALUES (?, ?)');
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
        var validate = validator(schema);
        if (!validate(user)) {
            deferred.reject(new Error(JSON.stringify(validate.errors)));
            return deferred.promise.nodeify(callback);
        }
        var sql = db.prepare('INSERT INTO DestinyGhostUserToken VALUES (?, ?)');
        sql.run(new Date().toISOString(), JSON.stringify(user));
        sql.finalize();
        deferred.resolve();
        return deferred.promise.nodeify(callback);
    };
    /**
     * Delete expired tokens.
     */
    var deleteExpiredUserTokens = function () {
        /**
         * @todo
         */
        var sql = db.prepare('DELETE FROM DestinyGhostUserToken WHERE id < \'' + new Date().toISOString() + '\'');
        sql.run();
        sql.finalize();
    };
    /**
     * Delete a user.
     * @param phoneNumber {string}
     */
    var deleteUser = function (phoneNumber) {
        var sql = db.prepare('DELETE FROM DestinyGhostUser WHERE id = \'' + phoneNumber + '\'');
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
        db.each('SELECT lower(hex(randomblob(' + (numberOfBytes || 16).toString() + '))) AS id', function (err, row) {
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
        db.each('SELECT id FROM DestinyGhostUserMessage WHERE json LIKE \'%"phoneNumber":"' +
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
        var client = new twilio.LookupsClient(settings.accountSid, settings.authToken);
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
        db.each('SELECT json FROM DestinyGhostUser', function (err, row) {
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
        db.all('SELECT json FROM DestinyGhostUser WHERE json LIKE \'%"emailAddress":"' +
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
     * @returns {*|Object}
     */
    var getUserByGamerTag = function (gamerTag) {
        var deferred = Q.defer();
        db.all('SELECT json FROM DestinyGhostUser WHERE json LIKE \'%"gamerTag":"' +
            gamerTag + '"%\'', function (err, rows) {
                if (err) {
                    deferred.reject(err);
                } else {
                    if (rows.length === 0) {
                        deferred.resolve();
                    } else {
                        if (rows.length === 1) {
                            deferred.resolve(JSON.parse(_.first(rows).json));
                        } else {
                            deferred.reject(new Error('The gamer tag, ' + gamerTag + ', is not unique.'));
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
        db.all('SELECT json FROM DestinyGhostUser WHERE json LIKE \'%"phoneNumber":"' +
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
        var deferred = Q.defer();
        db.each('SELECT id, json FROM DestinyGhostUserToken WHERE json LIKE \'%"emailAddress":"' +
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
    };
    /**
     * Get the user token by the phone number.
     * @param phoneNumber
     * @returns {*|Object}
     */
    var getUserTokenByPhoneNumber = function (phoneNumber) {
        var deferred = Q.defer();
        db.each('SELECT id, json FROM DestinyGhostUserToken WHERE json LIKE \'%"phoneNumber":"' +
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
    };
    /**
     * Get the user token by the phone number token.
     * @param phoneNumberToken
     * @returns {*|promise}
     */
    var getUserTokenByPhoneNumberToken = function (phoneNumberToken) {
        var deferred = Q.defer();
        db.each('SELECT id, json FROM DestinyGhostUserToken WHERE json LIKE \'%"phoneNumber":"' +
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
    };
    /**
     * Update the user.
     * @param user {Object}
     * @param callback
     * @returns {*|Array}
     */
    var updateUser = function (user, callback) {
        var deferred = Q.defer();
        var validate = validator(schema);
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
        getUserByPhoneNumber: getUserByPhoneNumber,
        getUserTokenByEmailAddressToken: getUserTokenByEmailAddressToken,
        getUserTokenByPhoneNumber: getUserTokenByPhoneNumber,
        getUserTokenByPhoneNumberToken: getUserTokenByPhoneNumberToken,
        updateUser: updateUser
    };
};

module.exports = Users;
