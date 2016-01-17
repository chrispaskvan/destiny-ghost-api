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
'use strict';
var _ = require('underscore'),
    fs = require('fs'),
    Q = require('q'),
    sqlite3 = require('sqlite3'),
    twilio = require('twilio'),
    validator = require('is-my-json-valid');
/**
 * @param databaseFullPath {string}
 * @param twilioSettingsFullPath {string}
 * @returns {{createUser: createUser, createUserMessage: createUserMessage,
  * getPhoneNumberType: getPhoneNumberType, getSubscribedUsers: getSubscribedUsers,
   * getUserByPhoneNumber: getUserByPhoneNumber, signIn: signIn}}
 * @constructor
 */
var User = function (databaseFullPath, twilioSettingsFullPath) {
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
    });
    /**
     * @private
     */
    var schema = {
        name: 'User',
        type: 'object',
        properties: {
            emailAddress: {
                type: 'string',
                format: 'email'
            },
            firstName: {
                required: true,
                type: 'string'
            },
            gamerTag: {
                type: 'string',
                minLength: 3,
                maxLength: 16
            },
            isSubscribedToBanshee44: {
                type: 'boolean'
            },
            isSubscribedToFoundryOrders: {
                type: 'boolean'
            },
            isSubscribedToLordSaladin: {
                type: 'boolean'
            },
            isSubscribedToXur: {
                type: 'boolean'
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
                required: true,
                type: 'string',
                format: 'phone'
            },
            carrier: {
                type: 'string'
            },
            type: {
                type: 'string'
            }
        },
        additionalProperties: true
    };
    /**
     * @member {Object}
     * @type {{accountSid: string, authToken string, phoneNumber string}} settings
     */
    var settings = JSON.parse(fs.readFileSync(twilioSettingsFullPath || './settings/twilio.json'));
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
     * Look up the user by their phone number.
     * @param phoneNumber {string}
     * @returns {*|object}
     * @private
     */
    var _getUserByPhoneNumber = function (phoneNumber) {
        var deferred = Q.defer();
        db.each('SELECT json FROM DestinyGhostUser WHERE json LIKE \'%"phoneNumber":"' +
            phoneNumber + '"%\' LIMIT 1', function (err, row) {
                if (err) {
                    deferred.reject(err);
                } else {
                    deferred.resolve(JSON.parse(row.json));
                }
            }, function (err, rows) {
                if (err) {
                    deferred.reject(err);
                } else {
                    if (rows === 0) {
                        deferred.resolve();
                    } else {
                        deferred.reject(new Error('The phone number, ' + phoneNumber + ', is not unique.'));
                    }
                }
            });
        return deferred.promise;
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
     *
     * @param phoneNumber
     * @param action
     * @param callback
     * @callback
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
        _getUserByPhoneNumber(user.phoneNumber)
            .then(function (existingUser) {
                if (existingUser) {
                    deferred.reject(new Error('The phone number, ' + user.phoneNumber + ', is already registered.'));
                    return deferred.promise.nodeify(callback);
                }
                getPhoneNumberType(user.phoneNumber)
                    .then(function (carrier) {
                        user.carrier = carrier.name;
                        user.type = carrier.type;
                        schema.additionalProperties = false;
                        var filter = validator.filter(schema);
                        var filteredUser = filter(user);
                        var sql = db.prepare('INSERT INTO DestinyGhostUser VALUES (?, ?)');
                        sql.run(new Date().toISOString(), JSON.stringify(filteredUser));
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
    var deleteUser = function (phoneNumber) {
        var sql = db.prepare('DELETE FROM DestinyGhostUser WHERE json LIKE \'%"phoneNumber":"' +
            phoneNumber + '"%\'');
        sql.run();
        sql.finalize();
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
     * Wrapper for internal function.
     * @param phoneNumber
     * @returns {*|Object}
     */
    var getUserByPhoneNumber = function (phoneNumber) {
        return _getUserByPhoneNumber(phoneNumber);
    };
    /**
     * Sign the user in and retrieve the Bungie cookies.
     * @param user {Object}
     * @returns {*|Array}
     */
    var updateUser = function (user) {
        /**
         * @todo
         */
    };
    return {
        actions: actions,
        cleanPhoneNumber: cleanPhoneNumber,
        createUser: createUser,
        createUserMessage: createUserMessage,
        deleteUser: deleteUser,
        getLastNotificationDate: getLastNotificationDate,
        getPhoneNumberType: getPhoneNumberType,
        getSubscribedUsers: getSubscribedUsers,
        getUserByPhoneNumber: getUserByPhoneNumber,
        updateUser: updateUser
    };
};

module.exports = User;
