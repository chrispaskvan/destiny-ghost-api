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
var _ = require('underscore'),
    Authentication = require('../models/authentication'),
    Destiny = require('../models/destiny'),
    fs = require('fs'),
    Ghost = require('../models/ghost'),
    JSend = require('../models/JSend'),
    notificationHeaders = require('../settings/notificationHeaders.json'),
    Notifications = require('../models/notifications'),
    path = require('path'),
    Q = require('q'),
    Users = require('../models/users'),
    World = require('../models/world');
/**
 *
 * @param loggingProvider
 * @returns {{create: create, init: init}}
 */
var notificationController = function (loggingProvider) {
    'use strict';
    /**
     * Authentication Model
     * @type {Authentication|exports|module.exports}
     */
    var authentication = new Authentication();
    /**
     * Destiny Model
     * @type {Destiny|exports|module.exports}
     */
    var destiny = new Destiny();
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
    /**
     * Shadow Users
     * @type {*|string}
     */
    var shadowUserConfiguration = './settings/shadowUsers.json';
    var shadowUsers = JSON.parse(fs.readFileSync(shadowUserConfiguration));
    if (!(shadowUsers && shadowUsers.constructor === Array)) {
        throw new Error('Unexpected shadow following me.');
    }
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
     * @type {{FieldTestWeapons: number, FoundryOrders: number, IronBannerEventRewards: number, Xur: number}}
     */
    var subscriptions = {
        FieldTestWeapons: 1,
        FoundryOrders: 2,
        IronBannerEventRewards: 3,
        Xur: 4
    };
    /**
     *
     * @param users
     * @param nextRefreshDate
     * @returns {*|promise}
     * @private
     */
    var _getFieldTestWeapons = function (users, nextRefreshDate) {
        var shadowUser = shadowUsers[0];
        return ghost.getLastManifest()
            .then(function (lastManifest) {
                var worldPath = path.join('./databases/', path.basename(lastManifest.mobileWorldContentPaths.en));
                return destiny.getCurrentUser(shadowUser.cookies)
                    .then(function (currentUser) {
                        return destiny.getCharacters(currentUser.membershipId)
                            .then(function (characters) {
                                return destiny.getFieldTestWeapons(characters[0].characterBase.characterId,
                                        shadowUser.cookies)
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
                                                                userPromises.push((nextRefreshDate ? userModel.getLastNotificationDate(user.phoneNumber, userModel.actions.Gunsmith) :
                                                                        (function () {
                                                                            var deferred = Q.defer();
                                                                            deferred.resolve(undefined);
                                                                            return deferred.promise;
                                                                        })())
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
        var shadowUser = shadowUsers[0];
        return ghost.getLastManifest()
            .then(function (lastManifest) {
                var worldPath = path.join('./databases/', path.basename(lastManifest.mobileWorldContentPaths.en));
                return destiny.getCurrentUser(shadowUser.cookies)
                    .then(function (currentUser) {
                        return destiny.getCharacters(currentUser.membershipId)
                            .then(function (characters) {
                                return destiny.getFoundryOrders(characters[0].characterBase.characterId, shadowUser.cookies)
                                    .then(function (items) {
                                        world.open(worldPath);
                                        return world.getVendorIcon(gunSmithHash)
                                            .then(function (iconUrl) {
                                                var now = new Date();
                                                var userPromises = [];
                                                if (items && items.length > 0) {
                                                    var itemHashes = _.map(items, function (item) {
                                                        return item.item.itemHash;
                                                    });
                                                    var itemPromises = [];
                                                    _.each(itemHashes, function (itemHash) {
                                                        itemPromises.push(world.getItemByHash(itemHash));
                                                    });
                                                    return Q.all(itemPromises)
                                                        .then(function (items) {
                                                            _.each(users, function (user) {
                                                                userPromises.push((nextRefreshDate ? userModel.getLastNotificationDate(user.phoneNumber, userModel.actions.Foundry) :
                                                                        (function () {
                                                                            var deferred = Q.defer();
                                                                            deferred.resolve(undefined);
                                                                            return deferred.promise;
                                                                        })())
                                                                    .then(function (notificationDate) {
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
                                                }
                                                _.each(users, function (user) {
                                                    userPromises.push((nextRefreshDate ? userModel.getLastNotificationDate(user.phoneNumber, userModel.actions.Xur) :
                                                            (function () {
                                                                var deferred = Q.defer();
                                                                deferred.resolve(undefined);
                                                                return deferred.promise;
                                                            })())
                                                        .then(function (notificationDate) {
                                                            if (notificationDate === undefined ||
                                                                    (nextRefreshDate < now && notificationDate < nextRefreshDate)) {
                                                                notifications.sendMessage('I favor the Häkke foundry in general. You? Regardless, we\'ll to have to wait and see what Banshee-44 has to offer.',
                                                                        user.phoneNumber, user.type === 'mobile' ? iconUrl : undefined)
                                                                    .then(function (message) {
                                                                        return userModel.createUserMessage(user, message, userModel.actions.Xur);
                                                                    });
                                                            }
                                                        }));
                                                });
                                                return Q.all(userPromises);
                                            })
                                            .fin(function () {
                                                world.close();
                                            });
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
        var shadowUser = shadowUsers[0];
        return ghost.getLastManifest()
            .then(function (lastManifest) {
                var worldPath = path.join('./databases/', path.basename(lastManifest.mobileWorldContentPaths.en));
                return destiny.getCurrentUser(shadowUser.cookies)
                    .then(function (currentUser) {
                        return destiny.getCharacters(currentUser.membershipId)
                            .then(function (characters) {
                                return destiny.getIronBannerEventRewards(characters[0].characterBase.characterId, shadowUser.cookies)
                                    .then(function (items) {
                                        world.open(worldPath);
                                        return world.getVendorIcon(lordSaladinHash)
                                            .then(function (iconUrl) {
                                                var now = new Date();
                                                var userPromises = [];
                                                if (items && items.length > 0) {
                                                    var itemHashes = _.map(items, function (item) {
                                                        return item.item.itemHash;
                                                    });
                                                    var itemPromises = [];
                                                    _.each(itemHashes, function (itemHash) {
                                                        itemPromises.push(world.getItemByHash(itemHash));
                                                    });
                                                    return Q.all(itemPromises)
                                                        .then(function (items) {
                                                            _.each(users, function (user) {
                                                                userPromises.push((nextRefreshDate ? userModel.getLastNotificationDate(user.phoneNumber, userModel.actions.IronBanner) :
                                                                        (function () {
                                                                            var deferred = Q.defer();
                                                                            deferred.resolve(undefined);
                                                                            return deferred.promise;
                                                                        })())
                                                                    .then(function (notificationDate) {
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
                                                }
                                                _.each(users, function (user) {
                                                    userPromises.push((nextRefreshDate ? userModel.getLastNotificationDate(user.phoneNumber, userModel.actions.Xur) :
                                                            (function () {
                                                                var deferred = Q.defer();
                                                                deferred.resolve(undefined);
                                                                return deferred.promise;
                                                            })())
                                                        .then(function (notificationDate) {
                                                            if (notificationDate === undefined ||
                                                                    (nextRefreshDate < now && notificationDate < nextRefreshDate)) {
                                                                notifications.sendMessage('Lord Saladin is off hosting a Iron Banner Crucible challenge in another galaxy far, far away.',
                                                                        user.phoneNumber, user.type === 'mobile' ? iconUrl : undefined)
                                                                    .then(function (message) {
                                                                        return userModel.createUserMessage(user, message, userModel.actions.Xur);
                                                                    });
                                                            }
                                                        }));
                                                });
                                                return Q.all(userPromises);
                                            })
                                            .fin(function () {
                                                world.close();
                                            });
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
        return destiny.getCurrentUser(shadowUsers[0].cookies)
            .then(function (currentUser) {
                return destiny.getCharacters(currentUser.membershipId)
                    .then(function (characters) {
                        return destiny.getVendorSummaries(characters[0].characterBase.characterId, shadowUsers[0].cookies)
                            .then(function (vendorSummaries) {
                                return vendorSummaries;
                            });
                    });
            });
    };
    /**
     *
     * @param users
     * @param nextRefreshDate {date} [undefined]
     * @private
     */
    var _getXur = function (users, nextRefreshDate) {
        return ghost.getLastManifest()
            .then(function (lastManifest) {
                var worldPath = path.join('./databases/', path.basename(lastManifest.mobileWorldContentPaths.en));
                return destiny.getXur()
                    .then(function (items) {
                        world.open(worldPath);
                        return world.getVendorIcon(xurHash)
                            .then(function (iconUrl) {
                                var now = new Date();
                                var userPromises = [];
                                if (items && items.length > 0) {
                                    var itemHashes = _.map(items, function (item) {
                                        return item.item.itemHash;
                                    });
                                    var itemPromises = [];
                                    _.each(itemHashes, function (itemHash) {
                                        itemPromises.push(world.getItemByHash(itemHash));
                                    });
                                    return Q.all(itemPromises)
                                        .then(function (items) {
                                            _.each(users, function (user) {
                                                userPromises.push((nextRefreshDate ? userModel.getLastNotificationDate(user.phoneNumber, userModel.actions.Xur) :
                                                        (function () {
                                                            var deferred = Q.defer();
                                                            deferred.resolve(undefined);
                                                            return deferred.promise;
                                                        })())
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
                                }
                                _.each(users, function (user) {
                                    userPromises.push((nextRefreshDate ? userModel.getLastNotificationDate(user.phoneNumber, userModel.actions.Xur) :
                                            (function () {
                                                var deferred = Q.defer();
                                                deferred.resolve(undefined);
                                                return deferred.promise;
                                            })())
                                        .then(function (notificationDate) {
                                            if (notificationDate === undefined ||
                                                    (nextRefreshDate < now && notificationDate < nextRefreshDate)) {
                                                notifications.sendMessage('Xur hasn\'t opened shop yet.', user.phoneNumber, user.type === 'mobile' ? iconUrl : undefined)
                                                    .then(function (message) {
                                                        return userModel.createUserMessage(user, message, userModel.actions.Xur);
                                                    });
                                            }
                                        }));
                                });
                                return Q.all(userPromises);
                            })
                            .fin(function () {
                                world.close();
                            });
                    });
            });
    };
    /**
     *
     * @param req
     * @param res
     */
    var create = function (req, res) {
        _.each(_.keys(notificationHeaders), function (headerName) {
            if (req.headers[headerName] !== notificationHeaders[headerName]) {
                res.writeHead(403);
                return res.end();
            }
        });
        var subscription = parseInt(req.params.subscription, 10);
        if (isNaN(subscription)) {
            res.json(new JSend.fail('That subscription is not recognized.'));
        }
        signIn()
            .then(function () {
                return userModel.getSubscribedUsers();
            })
            .then(function (users) {
                if (users && users.length > 0) {
                    if (parseInt(subscription, 10) === subscriptions.FieldTestWeapons) {
                        var bansheeSubscribers = _.filter(users, function (user) {
                            return user.isSubscribedToBanshee44 === true;
                        });
                        return _getFieldTestWeapons(bansheeSubscribers)
                            .then(function () {
                                res.json(new JSend.success());
                            });
                    }
                    if (parseInt(subscription, 10) === subscriptions.FoundryOrders) {
                        var foundrySubscribers = _.filter(users, function (user) {
                            return user.isSubscribedToBanshee44 === true;
                        });
                        return _getFoundryOrders(foundrySubscribers)
                            .then(function () {
                                res.json(new JSend.success());
                            });
                    }
                    if (parseInt(subscription, 10) === subscriptions.IronBannerEventRewards) {
                        var lordSaladinSubscribers = _.filter(users, function (user) {
                            return user.isSubscribedToLordSaladin === true;
                        });
                        return _getIronBannerEventRewards(lordSaladinSubscribers)
                            .then(function () {
                                res.json(new JSend.success());
                            });
                    }
                    if (parseInt(subscription, 10) === subscriptions.Xur) {
                        var xurSubscribers = _.filter(users, function (user) {
                            return user.isSubscribedToXur === true;
                        });
                        return _getXur(xurSubscribers)
                            .then(function () {
                                res.json(new JSend.success());
                            });
                    }
                } else {
                    res.json(new JSend.success());
                }
            })
            .fail(function (err) {
                res.json(new JSend.error(err.message));
                if (loggingProvider) {
                    loggingProvider.info(err);
                }
            });
    };
    /**
     *
     * @param shadowUser
     * @returns {*}
     * @private
     */
    var _validateShadowUser = function (shadowUser) {
        var now = new Date();
        var lastRefreshDate = shadowUser.lastRefreshDate === undefined ? new Date() : new Date(shadowUser.lastRefreshDate);
        var days = parseInt((now.getTime() - lastRefreshDate.getTime()) / (24 * 3600 * 1000));
        if (days > 2) {
            var deferred = Q.defer();
            deferred.resolve(shadowUser);
            return deferred.promise;
        }
        return authentication.signIn(shadowUser.userName, shadowUser.password, shadowUser.membershipType)
            .then(function (cookies) {
                return _.extend(shadowUser, {
                    cookies: _.map(_.keys(cookies), function (cookieName) {
                        return {
                            name: cookieName,
                            value: cookies[cookieName]
                        };
                    }),
                    lastRefreshDate: new Date().toISOString()
                });
            });
    };
    /**
     * Sign in and restart all jobs.
     */
    var signIn = function () {
        var promises = [];
        _.each(shadowUsers, function (shadowUser) {
            promises.push(_validateShadowUser(shadowUser));
        });
        return Q.all(promises)
            .then(function (shadowUsers) {
                fs.writeFileSync(shadowUserConfiguration, JSON.stringify(shadowUsers, null, 2));
            });
    };
    return {
        create: create,
        signIn: signIn
    };
};

module.exports = notificationController;
