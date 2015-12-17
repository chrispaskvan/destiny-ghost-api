/**
 * Created by chris on 10/30/15.
 */
'use strict';
var _ = require('underscore'),
    fs = require('fs'),
    Horseman = require('node-horseman'),
    Q = require('q'),
    sqlite3 = require('sqlite3'),
    twilio = require('twilio'),
    validator = require('is-my-json-valid');

var User = function (databaseFullPath, twilioSettingsFullPath) {
    databaseFullPath = databaseFullPath || './database/ghost.db';
    if (!fs.existsSync(databaseFullPath)) {
        console.log('Creating database file.');
        fs.openSync(databaseFullPath, 'w');
    }
    var db = new sqlite3.Database(databaseFullPath);
    db.configure('busyTimeout', 2000);
    db.serialize(function () {
        db.run('CREATE TABLE IF NOT EXISTS DestinyGhostUser(id TEXT, json BLOB)');
        db.run('CREATE TABLE IF NOT EXISTS DestinyGhostUserMessage(id TEXT, json BLOB)');
    });
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
    var settings = JSON.parse(fs.readFileSync(twilioSettingsFullPath || './settings/twilio.json'));
    var _getUserByPhoneNumber = function (phoneNumber) {
        var deferred = Q.defer();
        db.each('SELECT json FROM DestinyGhostUser WHERE json LIKE \'%"phoneNumber":"' + phoneNumber + '"%\' LIMIT 1', function (err, row) {
            if (err) {
                throw err;
            }
            deferred.resolve(JSON.parse(row.json));
        }, function (err, rows) {
            if (err) {
                throw err;
            }
            if (rows === 0) {
                deferred.resolve();
            }
        });
        return deferred.promise;
    };
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
    var createUser = function (user) {
        var validate = validator(schema);
        if (!validate(user)) {
            console.log(validate.errors);
        } else {
            _getUserByPhoneNumber(user.phoneNumber)
                .then(function (existingUser) {
                    if (existingUser) {
                        throw new Error('This phone number is already registered.');
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
                        });
                });
        }
    };
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
    var getSubscribedUsers = function () {
        var deferred = Q.defer();
        var users = [];
        db.each('SELECT json FROM DestinyGhostUser', function (err, row) {
            if (err) {
                throw err;
            }
            var user = JSON.parse(row.json);
            if (user.isSubscribedToBanshee44 || user.isSubscribedToXur) {
                users.push(user);
            }
        }, function (err) {
            if (err) {
                throw err;
            }
            deferred.resolve(users);
        });
        return deferred.promise;
    };
    var getUserByPhoneNumber = function (phoneNumber) {
        return _getUserByPhoneNumber(phoneNumber);
    };
    var signIn = function (userName, password) {
        if (!userName || !password) {
            throw new Error('Missing or incomplete credentials.');
        }
        var horseman;
        horseman = new Horseman();
        var deferred = Q.defer();
        horseman.open('https://www.bungie.net/en/User/SignIn/Psnid')
            .waitForSelector('#signInInput_SignInID')
            .type('input[id="signInInput_SignInID"]', userName)
            .type('input[id="signInInput_Password"]', password)
            .click('#signInButton')
            .waitForNextPage()
            .cookies()
            .then(function (cookies) {
                var bungieCookies = [{
                    name: 'bungled',
                    value: _.find(cookies, function (cookie) {
                        return cookie.name === 'bungled';
                    }).value
                }, {
                    name: 'bungledid',
                    value: _.find(cookies, function (cookie) {
                        return cookie.name === 'bungledid';
                    }).value
                }, {
                    name: 'bungleatk',
                    value: _.find(cookies, function (cookie) {
                        return cookie.name === 'bungleatk';
                    }).value
                }];
                horseman.close();
                deferred.resolve(bungieCookies);
            });
        return deferred.promise;
    };
    return {
        createUser: createUser,
        createUserMessage: createUserMessage,
        getPhoneNumberType: getPhoneNumberType,
        getSubscribedUsers: getSubscribedUsers,
        getUserByPhoneNumber: getUserByPhoneNumber,
        signIn: signIn
    };
};

module.exports = User;
