/**
 * A module for sending user notifications.
 *
 * @module notificationController
 * @author Chris Paskvan
 * @requires _
 * @requires AuthenticationController
 * @requires Destiny
 * @requires fs
 * @requires Ghost
 * @requires Notifications
 * @requires path
 * @requires Q
 * @requires User
 * @requires World
 */
'use strict';
var _ = require('underscore'),
    AuthenticationController = require('../controllers/authenticationController'),
    Destiny = require('../models/destiny'),
    fs = require('fs'),
    Ghost = require('../models/ghost'),
    Notifications = require('../models/notifications'),
    path = require('path'),
    Q = require('q'),
    User = require('../models/user'),
    World = require('../models/world');
/**
 * @type {*|CronJob}
 */
var CronJob = require('cron').CronJob;
/**
 * @param shadowUserConfiguration
 */
var notificationController = function (shadowUserConfiguration) {
    /**
     * Destiny Model
     * @type {Destiny|exports|module.exports}
     */
    var destiny;
    /**
     * Ghost Model
     * @type {Ghost|exports|module.exports}
     */
    var ghost = new Ghost(process.env.DATABASE);
    /**
     * Notifications Model
     * @type {Notifications|exports|module.exports}
     */
    var notifications = new Notifications(process.env.DATABASE, process.env.TWILIO);
    /**
     * World Model
     * @type {World|exports|module.exports}
     */
    var world;
    ghost.getWorldDatabasePath()
        .then(function (path) {
            world = new World(path);
        });
    /**
     * Use Model
     * @type {User|exports|module.exports}
     */
    var userModel = new User(process.env.DATABASE, process.env.TWILIO);
    shadowUserConfiguration = shadowUserConfiguration || './settings/ShadowUser.json';
    var shadowUser = JSON.parse(fs.readFileSync(shadowUserConfiguration));
    var _getCookieValueByName = function (cookies, cookieName) {
        if (!(cookies && cookies.constructor === Array)) {
            return undefined;
        }
        return _.find(cookies, function (cookie) {
            return cookie.name === cookieName;
        }).value;
    };
    var _getFieldTestWeapons = function (users, isSecondAttempt) {
        ghost.getLastManifest()
            .then(function (lastManifest) {
                var worldPath = path.join('./database/', path.basename(lastManifest.mobileWorldContentPaths.en));
                destiny.getCurrentUser()
                    .then(function (currentUser) {
                        destiny.getCharacters(currentUser.membershipId)
                            .then(function (characters) {
                                destiny.getFieldTestWeapons(characters[0].characterBase.characterId)
                                    .then(function (items) {
                                        if (items && items.length > 0) {
                                            var itemHashes = _.map(items, function (item) {
                                                return item.item.itemHash;
                                            });
                                            world.open(worldPath);
                                            var promises = [];
                                            _.each(itemHashes, function (itemHash) {
                                                promises.push(world.getItemByHash(itemHash));
                                            });
                                            Q.all(promises)
                                                .then(function (items) {
                                                    world.close();
                                                    _.each(users, function (user) {
                                                        notifications.sendMessage('The foundry is accepting orders for...\n' +
                                                            _.reduce(_.map(items, function (item) {
                                                                return item.itemName;
                                                            }), function (memo, itemName) {
                                                                return memo + itemName + '\n';
                                                            }, ' ').trim(), user.phoneNumber, user.type === 'mobile' ?
                                                                    'https://www.bungie.net/common/destiny_content/icons/6f00d5e7916a92e4d47f1b07816f276d.png'
                                                            : undefined)
                                                            .then(function (message) {
                                                                userModel.createUserMessage(user, message, 'Banshee-44');
                                                            });
                                                    });
                                                });
                                        }
                                    })
                                    .fail(function (err) {
                                        if (err.code === 99 && !isSecondAttempt) {
                                            var authenticationContoller = new AuthenticationController();
                                            authenticationContoller.signIn(shadowUser.userName, shadowUser.password)
                                                .then(function (cookies) {
                                                    destiny.setAuthenticationCookies(_getCookieValueByName(cookies, 'bungled'),
                                                        _getCookieValueByName(cookies, 'bungledid'),
                                                        _getCookieValueByName(cookies, 'bungleatk'));
                                                    _getFieldTestWeapons(users, true);
                                                });
                                        }
                                        throw err;
                                    });
                            });
                    });
            });
    };
    var _getVendorSummaries = function () {
        destiny.getCurrentUser()
            .then(function (currentUser) {
                destiny.getCharacters(currentUser.membershipId)
                    .then(function (characters) {
                        destiny.getVendorSummaries(characters[0].characterBase.characterId)
                            .then(function (vendors) {
                                _.each(vendors, function (vendor) {
                                    if (new Date(vendor.nextRefreshDate).getFullYear() < 9999) {
                                        ghost.upsertVendor(vendor);
                                    }
                                });
                            });
                    });
            });
    };
    var _getXur = function (users) {
        ghost.getLastManifest()
            .then(function (lastManifest) {
                var worldPath = path.join('./database/', path.basename(lastManifest.mobileWorldContentPaths.en));
                destiny.getXur()
                    .then(function (items) {
                        if (items && items.length > 0) {
                            var itemHashes = _.map(items, function (item) {
                                return item.item.itemHash;
                            });
                            world.open(worldPath);
                            var promises = [];
                            _.each(itemHashes, function (itemHash) {
                                promises.push(world.getItemByHash(itemHash));
                            });
                            Q.all(promises)
                                .then(function (items) {
                                    world.close();
                                    _.each(users, function (user) {
                                        notifications.sendMessage('Xur has arrived... for now...\n' +
                                            _.reduce(_.map(items, function (item) {
                                                return item.itemName;
                                            }), function (memo, itemName) {
                                                return memo + itemName + '\n';
                                            }, ' ').trim(), user.phoneNumber, user.type === 'mobile' ?
                                                    'https://www.bungie.net/common/destiny_content/icons/f37d959ec6b20ae2223f9edc1e057b80.png'
                                            : undefined)
                                            .then(function (message) {
                                                userModel.createUserMessage(user, message, 'Xur');
                                            });
                                    });
                                });
                        } else {
                            _.each(users, function (user) {
                                notifications.sendMessage('Xur hasn\'t opened shop yet.', user.phoneNumber)
                                    .then(function (message) {
                                        userModel.createUserMessage(user, message, 'Xur');
                                    });
                            });
                        }
                    })
                    .fail(function (err) {
                        throw err;
                    });
            });
    };
    /**
     * @constant
     * @type {string}
     * @description Banshee-44's Vendor Number
     */
    var gunSmithHash = '570929315';
    /**
     * @constant
     * @type {string}
     * @description Xur's Vendor Number
     */
    var xurHash = '2796397637';
    var _schedule = function () {
        userModel.getSubscribedUsers()
            .then(function (users) {
                if (users && users.length > 0) {
                    var t = new Date();
                    // ToDo(CP): Apply realistic schedule and log.
                    t.setSeconds(t.getSeconds() + 10);
                    new CronJob({
                        cronTime: t,
                        onTick: function () {
                            _getFieldTestWeapons(users);
                            this.stop();
                        },
                        onComplete: function () {
                            console.log('Job completed.');
                        },
                        start: true
                    });
                    new CronJob({
                        cronTime: t,
                        onTick: function () {
                            _getXur(users);
                            this.stop();
                        },
                        onComplete: function () {
                            console.log('Job completed.');
                        },
                        start: true
                    });
                    new CronJob({
                        cronTime: '00 00 00 * * *',
                        onTick: function () {
                            notifications.purgeMessages();
                            this.stop();
                        },
                        onComplete: function () {
                            /** ToDo Log Job Completion */
                            console.log('Job completed.');
                        },
                        start: true
                    });
                    new CronJob({
                        cronTime: t,
                        onTick: function () {
                            _getVendorSummaries();
                            this.stop();
                        },
                        onComplete: function () {
                            /** ToDo Log Job Completion */
                            console.log('Job completed.');
                        },
                        start: true
                    });
                }
            });
    };
    var init = function () {
        if (_getCookieValueByName(shadowUser.cookies, 'bungled') === undefined ||
                _getCookieValueByName(shadowUser.cookies, 'bungledid') === undefined ||
                _getCookieValueByName(shadowUser.cookies, 'bungleatk') === undefined) {
            userModel.signIn(shadowUser.userName, shadowUser.password)
                .then(function (cookies) {
                    shadowUser.cookies = cookies;
                    fs.writeFileSync(shadowUserConfiguration, JSON.stringify(shadowUser, null, 4));
                    destiny = new Destiny(shadowUser.apiKey, shadowUser.cookies);
                    _schedule();
                });
        } else {
            destiny = new Destiny(shadowUser.apiKey, shadowUser.cookies);
            _schedule();
        }
    };
    return {
        init: init
    };
};

module.exports = notificationController;
