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
    Authentication = require('../models/authentication'),
    Destiny = require('../models/destiny'),
    fs = require('fs'),
    Ghost = require('../models/ghost'),
    Notifications = require('../models/notifications'),
    path = require('path'),
    Q = require('q'),
    Users = require('../models/users'),
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
     * Authentication Model
     * @type {Authentication|exports|module.exports}
     */
    var authentication = new Authentication();
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
    var userModel = new Users(process.env.DATABASE, process.env.TWILIO);
    shadowUserConfiguration = shadowUserConfiguration || './settings/shadowUser.psn.json';
    var shadowUser = JSON.parse(fs.readFileSync(shadowUserConfiguration));
    /**
     * @constant
     * @type {string}
     * @description Banshee-44's Vendor Number
     */
    var gunSmithHash = 570929315;
    /**
     * @constant
     * @type {string}
     * @description Iron Banner's Vendor Number
     */
    var lordSaladinHash = 242140165;
    /**
     * @constant
     * @type {string}
     * @description Xur's Vendor Number
     */
    var xurHash = 2796397637;
    /**
     *
     * @param users
     * @param nextRefreshDate
     * @returns {*|promise}
     * @private
     */
    var _getFieldTestWeapons = function (users, nextRefreshDate) {
        return ghost.getLastManifest()
            .then(function (lastManifest) {
                var worldPath = path.join('./databases/', path.basename(lastManifest.mobileWorldContentPaths.en));
                return destiny.getCurrentUser(shadowUser.cookies)
                    .then(function (currentUser) {
                        return destiny.getCharacters(currentUser.membershipId)
                            .then(function (characters) {
                                return destiny.getFieldTestWeapons(characters[0].characterBase.characterId, shadowUser.cookies)
                                    .then(function (items) {
                                        if (items && items.length > 0) {
                                            var itemHashes = _.map(items, function (item) {
                                                return item.item.itemHash;
                                            });
                                            world.open(worldPath);
                                            return world.getVendorIcon(gunSmithHash)
                                                .then(function (iconUrl) {
                                                    var itemPromises = [];
                                                    _.each(itemHashes, function (itemHash) {
                                                        itemPromises.push(world.getItemByHash(itemHash));
                                                    });
                                                    return Q.all(itemPromises)
                                                        .then(function (items) {
                                                            var userPromises = [];
                                                            _.each(users, function (user) {
                                                                userPromises.push(userModel.getLastNotificationDate(user.phoneNumber, userModel.actions.Gunsmith)
                                                                    .then(function (notificationDate) {
                                                                        var now = new Date();
                                                                        var promises = [];
                                                                        if (notificationDate === undefined ||
                                                                                (nextRefreshDate < now && notificationDate < nextRefreshDate)) {
                                                                            promises.push(notifications.sendMessage('The following experimental weapons need testing in the field:\n' +
                                                                                _.reduce(_.map(items, function (item) {
                                                                                    return item.itemName;
                                                                                }), function (memo, itemName) {
                                                                                    return memo + itemName + '\n';
                                                                                }, ' ').trim(), user.phoneNumber, user.type === 'mobile' ? iconUrl : undefined)
                                                                                .then(function (message) {
                                                                                    return userModel.createUserMessage(user, message, userModel.actions.Gunsmith);
                                                                                }));
                                                                        }
                                                                        return Q.all(promises);
                                                                    }));
                                                            });
                                                            return Q.all(userPromises);
                                                        });
                                                })
                                                .fin(function () {
                                                    world.close();
                                                });
                                        }
                                    });
                            });
                    });
            });
    };
    /**
     *
     * @param users
     * @param nextRefreshDate
     * @returns {*|promise}
     * @private
     */
    var _getFoundryOrders = function (users, nextRefreshDate) {
        return ghost.getLastManifest()
            .then(function (lastManifest) {
                var worldPath = path.join('./databases/', path.basename(lastManifest.mobileWorldContentPaths.en));
                return destiny.getCurrentUser(shadowUser.cookies)
                    .then(function (currentUser) {
                        return destiny.getCharacters(currentUser.membershipId)
                            .then(function (characters) {
                                return destiny.getFoundryOrders(characters[0].characterBase.characterId, shadowUser.cookies)
                                    .then(function (items) {
                                        if (items && items.length > 0) {
                                            var itemHashes = _.map(items, function (item) {
                                                return item.item.itemHash;
                                            });
                                            world.open(worldPath);
                                            return world.getVendorIcon(gunSmithHash)
                                                .then(function (iconUrl) {
                                                    var itemPromises = [];
                                                    _.each(itemHashes, function (itemHash) {
                                                        itemPromises.push(world.getItemByHash(itemHash));
                                                    });
                                                    return Q.all(itemPromises)
                                                        .then(function (items) {
                                                            var userPromises = [];
                                                            _.each(users, function (user) {
                                                                userPromises.push(userModel.getLastNotificationDate(user.phoneNumber, userModel.actions.Gunsmith)
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
                                                                                }, ' ').trim(), user.phoneNumber, user.type === 'mobile' ? iconUrl : undefined)
                                                                                .then(function (message) {
                                                                                    return userModel.createUserMessage(user, message, userModel.actions.Gunsmith);
                                                                                }));
                                                                        }
                                                                        return Q.all(promises);
                                                                    }));
                                                            });
                                                            return Q.all(userPromises);
                                                        });
                                                })
                                                .fin(function () {
                                                    world.close();
                                                });
                                        }
                                    });
                            });
                    });
            });
    };
    /**
     *
     * @param users
     * @param nextRefreshDate
     * @returns {*|promise}
     * @private
     */
    var _getIronBannerEventRewards = function (users, nextRefreshDate) {
        return ghost.getLastManifest()
            .then(function (lastManifest) {
                var worldPath = path.join('./databases/', path.basename(lastManifest.mobileWorldContentPaths.en));
                return destiny.getCurrentUser(shadowUser.cookies)
                    .then(function (currentUser) {
                        return destiny.getCharacters(currentUser.membershipId)
                            .then(function (characters) {
                                return destiny.getIronBannerEventRewards(characters[0].characterBase.characterId, shadowUser.cookies)
                                    .then(function (items) {
                                        if (items && items.length > 0) {
                                            var itemHashes = _.map(items, function (item) {
                                                return item.item.itemHash;
                                            });
                                            world.open(worldPath);
                                            return world.getVendorIcon(lordSaladinHash)
                                                .then(function (iconUrl) {
                                                    var itemPromises = [];
                                                    _.each(itemHashes, function (itemHash) {
                                                        itemPromises.push(world.getItemByHash(itemHash));
                                                    });
                                                    return Q.all(itemPromises)
                                                        .then(function (items) {
                                                            var userPromises = [];
                                                            _.each(users, function (user) {
                                                                userPromises.push(userModel.getLastNotificationDate(user.phoneNumber, userModel.actions.IronBanner)
                                                                    .then(function (notificationDate) {
                                                                        var now = new Date();
                                                                        var promises = [];
                                                                        if (notificationDate === undefined ||
                                                                                (nextRefreshDate < now && notificationDate < nextRefreshDate)) {
                                                                            promises.push(notifications.sendMessage('Lord Saladin rewards only the strong.\n' +
                                                                                _.reduce(_.map(items, function (item) {
                                                                                    return item.itemName;
                                                                                }), function (memo, itemName) {
                                                                                    return memo + itemName + '\n';
                                                                                }, ' ').trim(), user.phoneNumber, user.type === 'mobile' ? iconUrl : undefined)
                                                                                .then(function (message) {
                                                                                    return userModel.createUserMessage(user, message, userModel.actions.IronBanner);
                                                                                }));
                                                                        }
                                                                        return Q.all(promises);
                                                                    }));
                                                            });
                                                            return Q.all(userPromises);
                                                        });
                                                })
                                                .fin(function () {
                                                    world.close();
                                                });
                                        }
                                    });
                            });
                    });
            });
    };
    /**
     *
     * @returns {*|promise}
     * @private
     */
    var _getVendorSummaries = function () {
        return destiny.getCurrentUser(shadowUser.cookies)
            .then(function (currentUser) {
                return destiny.getCharacters(currentUser.membershipId)
                    .then(function (characters) {
                        return destiny.getVendorSummaries(characters[0].characterBase.characterId, shadowUser.cookies)
                            .then(function (vendorSummaries) {
                                return vendorSummaries;
                            });
                    });
            });
    };
    /**
     *
     * @param users
     * @param nextRefreshDate
     * @private
     */
    var _getXur = function (users, nextRefreshDate) {
        return ghost.getLastManifest()
            .then(function (lastManifest) {
                var worldPath = path.join('./databases/', path.basename(lastManifest.mobileWorldContentPaths.en));
                return destiny.getXur()
                    .then(function (items) {
                        var now = new Date();
                        var userPromises = [];
                        if (items && items.length > 0) {
                            var itemHashes = _.map(items, function (item) {
                                return item.item.itemHash;
                            });
                            world.open(worldPath);
                            return world.getVendorIcon(xurHash)
                                .then(function (iconUrl) {
                                    var itemPromises = [];
                                    _.each(itemHashes, function (itemHash) {
                                        itemPromises.push(world.getItemByHash(itemHash));
                                    });
                                    return Q.all(itemPromises)
                                        .then(function (items) {
                                            _.each(users, function (user) {
                                                userPromises.push(userModel.getLastNotificationDate(user.phoneNumber, userModel.actions.Xur)
                                                    .then(function (notificationDate) {
                                                        if (notificationDate === undefined ||
                                                                (nextRefreshDate < now && notificationDate < nextRefreshDate)) {
                                                            return notifications.sendMessage('Xur has arrived... for now...\n' +
                                                                _.reduce(_.map(items, function (item) {
                                                                    return item.itemName;
                                                                }), function (memo, itemName) {
                                                                    return memo + itemName + '\n';
                                                                }, ' ').trim(), user.phoneNumber, user.type === 'mobile' ? iconUrl : undefined)
                                                                .then(function (message) {
                                                                    return userModel.createUserMessage(user, message, userModel.actions.Xur);
                                                                });
                                                        }
                                                    }));
                                            });
                                            return Q.all(userPromises);
                                        });
                                })
                                .fin(function () {
                                    world.close();
                                });
                        }
                        _.each(users, function (user) {
                            userPromises.push(userModel.getLastNotificationDate(user.phoneNumber, userModel.actions.Xur)
                                .then(function (notificationDate) {
                                    if (notificationDate === undefined ||
                                            (nextRefreshDate < now && notificationDate < nextRefreshDate)) {
                                        notifications.sendMessage('Xur hasn\'t opened shop yet.', user.phoneNumber)
                                            .then(function (message) {
                                                return userModel.createUserMessage(user, message, userModel.actions.Xur);
                                            });
                                    }
                                }));
                        });
                        return Q.all(userPromises);
                    });
            });
    };
    /**
     * Restart the jobs.
     * @private
     */
    var _restart = function () {
        _getVendorSummaries()
            .then(function (vendors) {
                _schedule(vendors);
            })
            .fail(function (err) {
                /**
                 * @todo Log
                 */
                console.log(err);
            });
    };
    var gunSmithJob;
    var xurJob;
    var _schedule = function (vendors) {
        return userModel.getSubscribedUsers()
            .then(function (users) {
                if (users && users.length > 0) {
                    _.each(vendors, function (vendor) {
                        if (vendor.vendorHash === gunSmithHash) {
                            var gunSmithSubscribers = _.filter(users, function (user) {
                                return user.isSubscribedToBanshee44 === true;
                            });
                            ghost.getNextRefreshDate(gunSmithHash)
                                .then(function (nextRefreshDate) {
                                    return _getFieldTestWeapons(gunSmithSubscribers, nextRefreshDate)
                                        .then(function () {
                                            ghost.upsertVendor(vendor);
                                            /**
                                             * Add a 5 minute factor of safety.
                                             */
                                            var notificationDate = new Date(vendor.nextRefreshDate);
                                            notificationDate.setUTCMinutes(5);
                                            gunSmithJob = new CronJob({
                                                cronTime: notificationDate,
                                                onTick: function () {
                                                    _getFieldTestWeapons(gunSmithSubscribers, vendor.nextRefreshDate);
                                                    /**
                                                     * Restart again in an hour.
                                                     */
                                                    setInterval(function () {
                                                        _restart();
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
                                })
                                .fail(function (err) {
                                    /**
                                     * @todo Log
                                     */
                                    console.log(err);
                                });

                        } else if (vendor.vendorHash === xurHash) {
                            var xurSubscribers = _.filter(users, function (user) {
                                return user.isSubscribedToXur === true;
                            });
                            ghost.getNextRefreshDate(xurHash)
                                .then(function (nextRefreshDate) {
                                    return _getXur(xurSubscribers, nextRefreshDate)
                                        .then(function () {
                                            ghost.upsertVendor(vendor);
                                            /**
                                             * Add a 5 minute factor of safety.
                                             */
                                            var notificationDate = new Date(vendor.nextRefreshDate);
                                            notificationDate.setUTCMinutes(5);
                                            xurJob = new CronJob({
                                                cronTime: notificationDate,
                                                onTick: function () {
                                                    _getXur(xurSubscribers, vendor.nextRefreshDate);
                                                    setInterval(function () {
                                                        _restart();
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
                                })
                                .fail(function (err) {
                                    /**
                                     * @todo Log
                                     */
                                    console.log(err);
                                });
                        } else {
                            ghost.upsertVendor(vendor);
                        }
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
    /**
     * Sign in and restart all jobs.
     */
    var init = function () {
        authentication.signIn(shadowUser.userName, shadowUser.password, shadowUser.membershipType)
            .then(function (cookies) {
                shadowUser.cookies = _.map(_.keys(cookies), function (cookieName) {
                    return {
                        name: cookieName,
                        value: cookies[cookieName]
                    };
                });
                fs.writeFileSync(shadowUserConfiguration, JSON.stringify(shadowUser, null, 4));
                destiny = new Destiny(shadowUser.apiKey);
                _restart();
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
