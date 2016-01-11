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
    var _getFieldTestWeapons = function (users, nextRefreshDate) {
        var deferred = Q.defer();
        ghost.getLastManifest()
            .then(function (lastManifest) {
                var worldPath = path.join('./database/', path.basename(lastManifest.mobileWorldContentPaths.en));
                destiny.getCurrentUser(shadowUser.cookies)
                    .then(function (currentUser) {
                        destiny.getCharacters(currentUser.membershipId)
                            .then(function (characters) {
                                destiny.getFieldTestWeapons(characters[0].characterBase.characterId, shadowUser.cookies)
                                    .then(function (items) {
                                        if (items && items.length > 0) {
                                            var itemHashes = _.map(items, function (item) {
                                                return item.item.itemHash;
                                            });
                                            world.open(worldPath);
                                            var itemPromises = [];
                                            _.each(itemHashes, function (itemHash) {
                                                itemPromises.push(world.getItemByHash(itemHash));
                                            });
                                            Q.all(itemPromises)
                                                .then(function (items) {
                                                    world.close();
                                                    _.each(users, function (user) {
                                                        userModel.getLastNotificationDate(user.phoneNumber, userModel.actions.Gunsmith)
                                                            .then(function (notificationDate) {
                                                                var now = new Date();
                                                                var promises = [];
                                                                if (notificationDate === undefined ||
                                                                        (nextRefreshDate < now && notificationDate < nextRefreshDate)) {
                                                                    promises.push(notifications.sendMessage('The foundry is accepting orders for...\n' +
                                                                        _.reduce(_.map(items, function (item) {
                                                                            return item.itemName;
                                                                        }), function (memo, itemName) {
                                                                            return memo + itemName + '\n';
                                                                        }, ' ').trim(), user.phoneNumber, user.type === 'mobile' ?
                                                                                'https://www.bungie.net/common/destiny_content/icons/6f00d5e7916a92e4d47f1b07816f276d.png'
                                                                        : undefined)
                                                                        .then(function (message) {
                                                                            userModel.createUserMessage(user, message, userModel.actions.Gunsmith);
                                                                        }));
                                                                }
                                                                Q.all(promises)
                                                                    .then(function () {
                                                                        deferred.resolve();
                                                                    });
                                                            })
                                                            .catch(function(err) {
                                                                /**
                                                                 * @todo Log
                                                                 */
                                                                throw err;
                                                            })
                                                            .fail(function (err) {
                                                                throw err;
                                                            });
                                                    });
                                                })
                                                .catch(function(err) {
                                                    throw err;
                                                })
                                                .fail(function (err) {
                                                    throw err;
                                                });
                                        }
                                    })
                                    .fail(function (err) {
                                        throw err;
                                    });
                            });
                    });
            });
        return deferred.promise;
    };
    var _getVendorSummaries = function () {
        var deferred = Q.defer();
        destiny.getCurrentUser(shadowUser.cookies)
            .then(function (currentUser) {
                destiny.getCharacters(currentUser.membershipId)
                    .then(function (characters) {
                        destiny.getVendorSummaries(characters[0].characterBase.characterId, shadowUser.cookies)
                            .then(function (vendors) {
                                var promises = [];
                                _.each(vendors, function (vendor) {
                                    if (new Date(vendor.nextRefreshDate).getFullYear() < 9999) {
                                        promises.push(ghost.upsertVendor(vendor));
                                    }
                                });
                                Q.all(promises)
                                    .then(function () {
                                        deferred.resolve();
                                    });
                            });
                    });
            })
            .fail(function (err) {
                deferred.reject(err);
            });
        return deferred.promise;
    };
    var _getXur = function (users, nextRefreshDate) {
        ghost.getLastManifest()
            .then(function (lastManifest) {
                var worldPath = path.join('./database/', path.basename(lastManifest.mobileWorldContentPaths.en));
                destiny.getXur()
                    .then(function (items) {
                        var now = new Date();
                        if (items && items.length > 0) {
                            var itemHashes = _.map(items, function (item) {
                                return item.item.itemHash;
                            });
                            world.open(worldPath);
                            var itemPromises = [];
                            _.each(itemHashes, function (itemHash) {
                                itemPromises.push(world.getItemByHash(itemHash));
                            });
                            Q.all(itemPromises)
                                .then(function (items) {
                                    world.close();
                                    _.each(users, function (user) {
                                        userModel.getLastNotificationDate(user.phoneNumber, userModel.actions.Xur)
                                            .then(function (notificationDate) {
                                                if (notificationDate === undefined ||
                                                        (nextRefreshDate < now && notificationDate < nextRefreshDate)) {
                                                    notifications.sendMessage('Xur has arrived... for now...\n' +
                                                        _.reduce(_.map(items, function (item) {
                                                            return item.itemName;
                                                        }), function (memo, itemName) {
                                                            return memo + itemName + '\n';
                                                        }, ' ').trim(), user.phoneNumber, user.type === 'mobile' ?
                                                                'https://www.bungie.net/common/destiny_content/icons/f37d959ec6b20ae2223f9edc1e057b80.png'
                                                        : undefined)
                                                        .then(function (message) {
                                                            userModel.createUserMessage(user, message, userModel.actions.Xur);
                                                        });
                                                }
                                            });
                                    });
                                });
                        } else {
                            _.each(users, function (user) {
                                userModel.getLastNotificationDate(user.phoneNumber, userModel.actions.Xur)
                                    .then(function (notificationDate) {
                                        if (notificationDate === undefined ||
                                                (nextRefreshDate < now && notificationDate < nextRefreshDate)) {
                                            notifications.sendMessage('Xur hasn\'t opened shop yet.', user.phoneNumber)
                                                .then(function (message) {
                                                    userModel.createUserMessage(user, message, userModel.actions.Xur);
                                                });
                                        }
                                    });
                            });
                        }
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
    var gunSmithJob;
    var xurJob;
    var _schedule = function () {
        userModel.getSubscribedUsers()
            .then(function (users) {
                if (users && users.length > 0) {
                    var gunSmithSubscribers = _.filter(users, function (user) {
                        return user.isSubscribedToBanshee44 === true;
                    });
                    ghost.getNextRefreshDate(gunSmithHash)
                        .then(function (nextRefreshDate) {
                            _getFieldTestWeapons(gunSmithSubscribers, nextRefreshDate)
                                .then(function () {
                                    /**
                                     * Add a 2 minute factor of safety.
                                     */
                                    nextRefreshDate.setSeconds(nextRefreshDate.getSeconds() + 120);
                                    gunSmithJob = new CronJob({
                                        cronTime: nextRefreshDate,
                                        onTick: function () {
                                            _getFieldTestWeapons(gunSmithSubscribers, nextRefreshDate);
                                            setInterval(function () {
                                                _reset();
                                            }, 3600000);
                                            this.stop();
                                        },
                                        onComplete: function () {
                                            /**
                                             * @todo Log
                                             */
                                            console.log('Job completed.');
                                        },
                                        start: true
                                    });
                                });
                        });
                    var xurSubscribers = _.filter(users, function (user) {
                        return user.isSubscribedToXur === true;
                    });
                    ghost.getNextRefreshDate(xurHash)
                        .then(function (nextRefreshDate) {
                            _getXur(xurSubscribers, nextRefreshDate)
                                .then(function () {
                                    /**
                                     * Add a 2 minute factor of safety.
                                     */
                                    nextRefreshDate.setSeconds(nextRefreshDate.getSeconds() + 120);
                                    xurJob = new CronJob({
                                        cronTime: nextRefreshDate,
                                        onTick: function () {
                                            _getXur(xurSubscribers, nextRefreshDate);
                                            setInterval(function () {
                                                _reset();
                                            }, 3600000);
                                            this.stop();
                                        },
                                        onComplete: function () {
                                            /**
                                             * @todo Log
                                             */
                                            console.log('Job completed.');
                                        },
                                        start: true
                                    });
                                });
                        });
                    new CronJob({
                        cronTime: '00 00 00 * * *',
                        onTick: function () {
                            notifications.purgeMessages();
                            this.stop();
                        },
                        onComplete: function () {
                            /**
                             * @todo Log
                             */
                            console.log('Job completed.');
                        },
                        start: true
                    });
                }
            });
    };
    var init = function () {
        userModel.signIn(shadowUser.userName, shadowUser.password)
            .then(function (cookies) {
                shadowUser.cookies = cookies;
                fs.writeFileSync(shadowUserConfiguration, JSON.stringify(shadowUser, null, 4));
                destiny = new Destiny(shadowUser.apiKey);
                _getVendorSummaries()
                    .then(function () {
                        _schedule();
                    });
            })
            .fail(function (err) {
                /**
                 * @todo Log
                 */
                console.log(err);
            });
    };
    return {
        init: init
    };
};

module.exports = notificationController;
