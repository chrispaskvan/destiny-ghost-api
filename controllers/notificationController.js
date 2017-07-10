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
 * @constructor
 * @param loggingProvider
 */
function NotificationController(loggingProvider) {
    'use strict';
    this.loggingProvider = loggingProvider;
    /**
     * Authentication Model
     * @type {Authentication|exports|module.exports}
     */
    this.authentication = new Authentication();
    /**
     * Destiny Model
     * @type {Destiny|exports|module.exports}
     */
    this.destiny = new Destiny();
    /**
     * Ghost Model
     * @type {Ghost|exports|module.exports}
     */
    this.ghost = new Ghost(process.env.DATABASE);
    /**
     * Notifications Model
     * @type {Notifications|exports|module.exports}
     */
    this.notifications = new Notifications(process.env.DATABASE, process.env.TWILIO);
    /**
     * World Model
     * @type {World|exports|module.exports}
     */
    this.world = new World();
    /**
     * Use Model
     * @type {User|exports|module.exports}
     */
    this.users = new Users(process.env.DATABASE, process.env.TWILIO);
    /**
     * Shadow Users
     * @type {*|string}
     */
    this.shadowUserConfiguration = './settings/shadowUsers.json';
    this.shadowUsers = JSON.parse(fs.readFileSync(this.shadowUserConfiguration));
    if (!(this.shadowUsers && this.shadowUsers.constructor === Array)) {
        throw new Error('Unexpected shadow following me.');
    }
}
/**
 * @namespace
 * @type {{confirm, enter, getEmailAddress, getGamerTag, getPhoneNumber, getUserByEmailAddressToken, knock, register, update}}
 */
NotificationController.prototype = (function () {
    'use strict';
    /**
     * @constant
     * @type {string}
     * @description Banshee-44's Vendor Number
     */
    var gunSmithHash = '570929315';
    /**
     * @constant
     * @type {string}
     * @description Iron Banner's Vendor Number
     */
    var lordSaladinHash = '242140165';
    /**
     * @constant
     * @type {string}
     * @description Xur's Vendor Number
     */
    var xurHash = '2796397637';
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
        var self = this;
        var shadowUser = this.shadowUsers[0];
        return this.ghost.getLastManifest()
            .then(function (lastManifest) {
                var worldPath = path.join('./databases/', path.basename(lastManifest.mobileWorldContentPaths.en));
                return self.destiny.getCurrentUser(shadowUser.cookies)
                    .then(function (currentUser) {
                        return self.destiny.getCharacters(currentUser.membershipId, currentUser.membershipType)
                            .then(function (characters) {
                                return self.destiny.getFieldTestWeapons(characters[0].characterBase.characterId,
                                        shadowUser.cookies)
                                    .then(function (items) {
                                        if (items && items.length > 0) {
                                            var itemHashes = _.map(items, function (item) {
                                                return item.item.itemHash;
                                            });
                                            self.world.open(worldPath);
                                            return self.world.getVendorIcon(gunSmithHash)
                                                .then(function (iconUrl) {
                                                    var itemPromises = [];
                                                    _.each(itemHashes, function (itemHash) {
                                                        itemPromises.push(self.world.getItemByHash(itemHash));
                                                    });
                                                    return Q.all(itemPromises)
                                                        .then(function (items) {
                                                            var userPromises = [];
                                                            _.each(users, function (user) {
                                                                userPromises.push((nextRefreshDate ? self.users.getLastNotificationDate(user.phoneNumber, self.users.actions.Gunsmith) :
                                                                        (function () {
                                                                            var deferred = Q.defer();
                                                                            deferred.resolve(undefined);
                                                                            return deferred.promise;
                                                                        }()))
                                                                    .then(function (notificationDate) {
                                                                        var now = new Date();
                                                                        var promises = [];
                                                                        if (notificationDate === undefined ||
                                                                                (nextRefreshDate < now && notificationDate < nextRefreshDate)) {
                                                                            promises.push(self.notifications.sendMessage('The following experimental weapons need testing in the field:\n' +
                                                                                _.reduce(_.map(items, function (item) {
                                                                                    return item.itemName;
                                                                                }), function (memo, itemName) {
                                                                                    return memo + itemName + '\n';
                                                                                }, ' ').trim(), user.phoneNumber, user.type === 'mobile' ? iconUrl : '')
                                                                                .then(function (message) {
                                                                                    return self.users.createUserMessage(user, message, self.users.actions.Gunsmith);
                                                                                }));
                                                                        }
                                                                        return Q.all(promises);
                                                                    }));
                                                            });
                                                            return Q.all(userPromises);
                                                        });
                                                })
                                                .fin(function () {
                                                    self.world.close();
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
        var self = this;
        var shadowUser = this.shadowUsers[0];
        return this.ghost.getLastManifest()
            .then(function (lastManifest) {
                var worldPath = path.join('./databases/', path.basename(lastManifest.mobileWorldContentPaths.en));
                return self.destiny.getCurrentUser(shadowUser.cookies)
                    .then(function (currentUser) {
                        return self.destiny.getCharacters(currentUser.membershipId, currentUser.membershipType)
                            .then(function (characters) {
                                return self.destiny.getFoundryOrders(characters[0].characterBase.characterId, shadowUser.cookies)
                                    .then(function (foundryOrders) {
                                        self.world.open(worldPath);
                                        return self.world.getVendorIcon(gunSmithHash)
                                            .then(function (iconUrl) {
                                                var now = new Date();
                                                var userPromises = [];
                                                if (foundryOrders.items && foundryOrders.items.length > 0) {
                                                    var itemHashes = _.map(foundryOrders.items, function (item) {
                                                        return item.item.itemHash;
                                                    });
                                                    var itemPromises = [];
                                                    _.each(itemHashes, function (itemHash) {
                                                        itemPromises.push(self.world.getItemByHash(itemHash));
                                                    });
                                                    return Q.all(itemPromises)
                                                        .then(function (items) {
                                                            _.each(users, function (user) {
                                                                userPromises.push((nextRefreshDate ? self.users.getLastNotificationDate(user.phoneNumber, self.users.actions.Foundry) :
                                                                        (function () {
                                                                            var deferred = Q.defer();
                                                                            deferred.resolve(undefined);
                                                                            return deferred.promise;
                                                                        }()))
                                                                    .then(function (notificationDate) {
                                                                        var promises = [];
                                                                        if (notificationDate === undefined ||
                                                                                (nextRefreshDate < now && notificationDate < nextRefreshDate)) {
                                                                            promises.push(self.notifications.sendMessage('The foundry is accepting orders for...\n' +
                                                                                _.reduce(_.map(items, function (item) {
                                                                                    return item.itemName;
                                                                                }), function (memo, itemName) {
                                                                                    return memo + itemName + '\n';
                                                                                }, ' ').trim(), user.phoneNumber, user.type === 'mobile' ? iconUrl : '')
                                                                                .then(function (message) {
                                                                                    return self.users.createUserMessage(user, message, self.users.actions.Gunsmith);
                                                                                }));
                                                                        }
                                                                        return Q.all(promises);
                                                                    }));
                                                            });
                                                            return Q.all(userPromises);
                                                        });
                                                }
                                                _.each(users, function (user) {
                                                    userPromises.push((nextRefreshDate ? self.users.getLastNotificationDate(user.phoneNumber, self.users.actions.Xur) :
                                                            (function () {
                                                                var deferred = Q.defer();
                                                                deferred.resolve(undefined);
                                                                return deferred.promise;
                                                            }()))
                                                        .then(function (notificationDate) {
                                                            if (notificationDate === undefined ||
                                                                    (nextRefreshDate < now && notificationDate < nextRefreshDate)) {
                                                                self.notifications.sendMessage('I favor the Häkke foundry in general. You? Regardless, we\'ll to have to wait and see what Banshee-44 has to offer.',
                                                                        user.phoneNumber, user.type === 'mobile' ? iconUrl : '')
                                                                    .then(function (message) {
                                                                        return self.users.createUserMessage(user, message, self.users.actions.Xur);
                                                                    });
                                                            }
                                                        }));
                                                });
                                                return Q.all(userPromises);
                                            })
                                            .fin(function () {
                                                self.world.close();
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
        var self = this;
        var shadowUser = this.shadowUsers[0];
        return this.ghost.getLastManifest()
            .then(function (lastManifest) {
                var worldPath = path.join('./databases/', path.basename(lastManifest.mobileWorldContentPaths.en));
                return self.destiny.getCurrentUser(shadowUser.cookies)
                    .then(function (currentUser) {
                        return self.destiny.getCharacters(currentUser.membershipId, currentUser.membershipType)
                            .then(function (characters) {
                                var characterPromises = [];
                                _.each(characters, function (character) {
                                    characterPromises.push(self.destiny.getIronBannerEventRewards(character.characterBase.characterId, shadowUser.cookies));
                                });
                                return Q.all(characterPromises)
                                    .then(function (characterItems) {
                                        var items = _.flatten(characterItems);
                                        self.world.open(worldPath);
                                        return self.world.getVendorIcon(lordSaladinHash)
                                            .then(function (iconUrl) {
                                                var now = new Date();
                                                var userPromises = [];
                                                if (items && items.length > 0) {
                                                    var itemHashes = _.uniq(_.map(items, function (item) {
                                                        return item.item.itemHash;
                                                    }));
                                                    var itemPromises = [];
                                                    _.each(itemHashes, function (itemHash) {
                                                        itemPromises.push(self.world.getItemByHash(itemHash));
                                                    });
                                                    return Q.all(itemPromises)
                                                        .then(function (items) {
                                                            _.each(users, function (user) {
                                                                userPromises.push((nextRefreshDate ? self.users.getLastNotificationDate(user.phoneNumber, self.users.actions.IronBanner) :
                                                                        (function () {
                                                                            var deferred = Q.defer();
                                                                            deferred.resolve(undefined);
                                                                            return deferred.promise;
                                                                        }()))
                                                                    .then(function (notificationDate) {
                                                                        var promises = [];
                                                                        if (notificationDate === undefined ||
                                                                                (nextRefreshDate < now && notificationDate < nextRefreshDate)) {
                                                                            var weapons = _.filter(items, function (item) {
                                                                                return _.contains(item.itemCategoryHashes, 1);
                                                                            });
                                                                            var hunterArmor = _.filter(items, function (item) {
                                                                                return _.contains(item.itemCategoryHashes, 20) &&
                                                                                    _.contains(item.itemCategoryHashes, 23);
                                                                            });
                                                                            var titanArmor = _.filter(items, function (item) {
                                                                                return _.contains(item.itemCategoryHashes, 20) &&
                                                                                    _.contains(item.itemCategoryHashes, 22);
                                                                            });
                                                                            var warlockArmor = _.filter(items, function (item) {
                                                                                return _.contains(item.itemCategoryHashes, 20) &&
                                                                                    _.contains(item.itemCategoryHashes, 21);
                                                                            });
                                                                            var vendor = {
                                                                                rewards: { weapons: _.map(weapons, function (item) {
                                                                                    return item.itemName;
                                                                                }), armor: { hunter: _.map(hunterArmor, function (item) {
                                                                                    return item.itemName;
                                                                                }), titan: _.map(titanArmor, function (item) {
                                                                                    return item.itemName;
                                                                                }), warlock: _.map(warlockArmor, function (item) {
                                                                                    return item.itemName;
                                                                                })}},
                                                                                iconUrl: iconUrl
                                                                            };
                                                                            promises.push(self.notifications.sendMessage('Lord Saladin rewards only the strong.\n' + _.reduce(vendor.rewards.weapons, function (memo, weapon) {
                                                                                return memo + '\n' + weapon;
                                                                            }, ' ').trim().substr(0, 130), user.phoneNumber, user.type === 'mobile' ? iconUrl : '')
                                                                                .then(function (message) {
                                                                                    return self.users.createUserMessage(user, message, self.users.actions.IronBanner);
                                                                                }));
                                                                            promises.push(self.notifications.sendMessage('Hunters:\n' + _.reduce(vendor.rewards.armor.hunter,
                                                                                function (memo, classArmor) {
                                                                                    return memo + '\n' + classArmor;
                                                                                },
                                                                                ' ').trim().substr(0, 130), user.phoneNumber, '')
                                                                                .then(function (message) {
                                                                                    return self.users.createUserMessage(user, message, self.users.actions.IronBanner);
                                                                                }));
                                                                            promises.push(self.notifications.sendMessage('Titans:\n' + _.reduce(vendor.rewards.armor.titan,
                                                                                function (memo, classArmor) {
                                                                                    return memo + '\n' + classArmor;
                                                                                }, ' ').trim().substr(0, 130), user.phoneNumber, '')
                                                                                .then(function (message) {
                                                                                    return self.users.createUserMessage(user, message, self.users.actions.IronBanner);
                                                                                }));
                                                                            promises.push(self.notifications.sendMessage('Warlocks:\n' + _.reduce(vendor.rewards.armor.warlock,
                                                                                function (memo, classArmor) {
                                                                                    return memo + '\n' + classArmor;
                                                                                }, ' ').trim().substr(0, 130), user.phoneNumber, '')
                                                                                .then(function (message) {
                                                                                    return self.users.createUserMessage(user, message, self.users.actions.IronBanner);
                                                                                }));
                                                                        }
                                                                        return Q.all(promises);
                                                                    }));
                                                            });
                                                            return Q.all(userPromises);
                                                        });
                                                }
                                                _.each(users, function (user) {
                                                    userPromises.push((nextRefreshDate ? self.users.getLastNotificationDate(user.phoneNumber, self.users.actions.Xur) :
                                                            (function () {
                                                                var deferred = Q.defer();
                                                                deferred.resolve(undefined);
                                                                return deferred.promise;
                                                            }()))
                                                        .then(function (notificationDate) {
                                                            if (notificationDate === undefined ||
                                                                    (nextRefreshDate < now && notificationDate < nextRefreshDate)) {
                                                                self.notifications.sendMessage('Lord Saladin is off hosting a Iron Banner Crucible challenge in another galaxy far, far away.',
                                                                        user.phoneNumber, user.type === 'mobile' ? iconUrl : '')
                                                                    .then(function (message) {
                                                                        return self.users.createUserMessage(user, message, self.users.actions.Xur);
                                                                    });
                                                            }
                                                        }));
                                                });
                                                return Q.all(userPromises);
                                            })
                                            .fin(function () {
                                                self.world.close();
                                            });
                                    });
                            });
                    });
            });
    };
    /**
     *
     * @param subscribedUsers
     * @param nextRefreshDate {date} [undefined]
     * @private
     */
    var _getXur = function (subscribedUsers, nextRefreshDate) {
        var self = this;
        return this.ghost.getLastManifest()
            .then(function (lastManifest) {
                var worldPath = path.join('./databases/', path.basename(lastManifest.mobileWorldContentPaths.en));
                return self.destiny.getXur()
                    .then(function (items) {
                        self.world.open(worldPath);
                        return self.world.getVendorIcon(xurHash)
                            .then(function (iconUrl) {
                                var now = new Date();
                                var userPromises = [];
                                if (items && items.length > 0) {
                                    var itemHashes = _.map(items, function (item) {
                                        return item.item.itemHash;
                                    });
                                    var itemPromises = [];
                                    _.each(itemHashes, function (itemHash) {
                                        itemPromises.push(self.world.getItemByHash(itemHash));
                                    });
                                    return Q.all(itemPromises)
                                        .then(function (items) {
                                            _.each(subscribedUsers, function (user) {
                                                userPromises.push((nextRefreshDate ? self.users.getLastNotificationDate(user.phoneNumber, self.users.actions.Xur) :
                                                        (function () {
                                                            var deferred = Q.defer();
                                                            deferred.resolve(undefined);
                                                            return deferred.promise;
                                                        }()))
                                                    .then(function (notificationDate) {
                                                        if (notificationDate === undefined ||
                                                                (nextRefreshDate < now && notificationDate < nextRefreshDate)) {
                                                            return self.notifications.sendMessage('Xur has arrived... for now...\n' +
                                                                _.reduce(_.map(items, function (item) {
                                                                    return item.itemName;
                                                                }), function (memo, itemName) {
                                                                    return memo + itemName + '\n';
                                                                }, ' ').trim(), user.phoneNumber, user.type === 'mobile' ? iconUrl : '')
                                                                .then(function (message) {
                                                                    return self.users.createUserMessage(user, message, self.users.actions.Xur);
                                                                });
                                                        }
                                                    }));
                                            });
                                            return Q.all(userPromises);
                                        });
                                }
                                _.each(subscribedUsers, function (user) {
                                    userPromises.push((nextRefreshDate ? self.users.getLastNotificationDate(user.phoneNumber, self.users.actions.Xur) :
                                            (function () {
                                                var deferred = Q.defer();
                                                deferred.resolve(undefined);
                                                return deferred.promise;
                                            }()))
                                        .then(function (notificationDate) {
                                            if (notificationDate === undefined ||
                                                    (nextRefreshDate < now && notificationDate < nextRefreshDate)) {
                                                self.notifications.sendMessage('Xur hasn\'t opened shop yet.', user.phoneNumber, user.type === 'mobile' ? iconUrl : '')
                                                    .then(function (message) {
                                                        return self.users.createUserMessage(user, message, self.users.actions.Xur);
                                                    });
                                            }
                                        }));
                                });
                                return Q.all(userPromises);
                            })
                            .fin(function () {
                                self.world.close();
                            });
                    });
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
        var days = parseInt((now.getTime() - lastRefreshDate.getTime()) / (24 * 3600 * 1000), 10);
        if (shadowUser.cookies && days < 2) {
            var deferred = Q.defer();
            deferred.resolve(shadowUser);
            return deferred.promise;
        }
        return this.authentication.signIn(shadowUser.userName, shadowUser.password, shadowUser.membershipType)
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
        var self = this;
        var promises = [];
        _.each(this.shadowUsers, function (shadowUser) {
            promises.push(_validateShadowUser.call(self, shadowUser));
        });
        return Q.all(promises)
            .then(function (shadowUsers) {
                fs.writeFileSync(self.shadowUserConfiguration, JSON.stringify(shadowUsers, null, 2));
            });
    };

    /**
     *
     * @param res
     * @param subscribedUsers
     * @param subscription
     * @returns {Request|*}
     * @private
     */
    function _create(res, subscribedUsers, subscription) {
        var self = this;// jshint ignore:line
        if (subscribedUsers && subscribedUsers.length > 0) {
            if (parseInt(subscription, 10) === subscriptions.FieldTestWeapons) {
                var bansheeSubscribers = _.filter(subscribedUsers, function (user) {
                    var notification = _.find(user.notifications, function (notification) {
                        return notification.type === self.users.actions.Gunsmith;
                    });
                    return notification && notification.enabled === true;
                });
                return _getFieldTestWeapons.call(self, bansheeSubscribers)
                    .then(function () {
                        res.json(new JSend.success());
                    });
            }
            if (parseInt(subscription, 10) === subscriptions.FoundryOrders) {
                var foundrySubscribers = _.filter(subscribedUsers, function (user) {
                    var notification = _.find(user.notifications, function (notification) {
                        return notification.type === self.users.actions.Foundry;
                    });
                    return notification && notification.enabled === true;
                });
                return _getFoundryOrders.call(self, foundrySubscribers)
                    .then(function () {
                        res.json(new JSend.success());
                    });
            }
            if (parseInt(subscription, 10) === subscriptions.IronBannerEventRewards) {
                var lordSaladinSubscribers = _.filter(subscribedUsers, function (user) {
                    var notification = _.find(user.notifications, function (notification) {
                        return notification.type === self.users.actions.IronBanner;
                    });
                    return notification && notification.enabled === true;
                });
                return _getIronBannerEventRewards.call(self, lordSaladinSubscribers)
                    .then(function () {
                        res.json(new JSend.success());
                    });
            }
            if (parseInt(subscription, 10) === subscriptions.Xur) {
                var xurSubscribers = _.filter(subscribedUsers, function (user) {
                    var notification = _.find(user.notifications, function (notification) {
                        return notification.type === self.users.actions.Xur;
                    });
                    return notification && notification.enabled === true;
                });
                return _getXur.call(self, xurSubscribers)
                    .then(function () {
                        res.json(new JSend.success());
                    });
            }
        } else {
            res.json(new JSend.success());
        }
    }
    /**
     *
     * @param req
     * @param res
     */
    var create = function (req, res) {
        var self = this;
        _.each(_.keys(notificationHeaders), function (headerName) {
            if (req.headers[headerName] !== notificationHeaders[headerName]) {
                res.writeHead(403);
                res.end();
                return;
            }
        });
        var subscription = parseInt(req.params.subscription, 10);
        if (isNaN(subscription)) {
            res.json(new JSend.fail('That subscription is not recognized.'));
        }
        this.signIn()
            .then(function () {
                return self.users.getSubscribedUsers();
            })
            .then(function (subscribedUsers) {
                _create.call(self, res, subscribedUsers, subscription);
            })
            .fail(function (err) {
                res.json(new JSend.error(err.message));
                if (self.loggingProvider) {
                    self.loggingProvider.info(err);
                }
            });
    };
    var createForUser = function (req, res) {
        var self = this;
        _.each(_.keys(notificationHeaders), function (headerName) {
            if (req.headers[headerName] !== notificationHeaders[headerName]) {
                res.writeHead(403);
                res.end();
                return;
            }
        });
        var subscription = parseInt(req.params.subscription, 10);
        if (isNaN(subscription)) {
            res.json(new JSend.fail('That subscription is not recognized.'));
        }
        this.signIn()
            .then(function () {
                return self.users.getUserByPhoneNumber(req.params.phoneNumber);
            })
            .then(function (subscribedUser) {
                if (!subscribedUser) {
                    res.writeHead(404).end();
                }
                _create.call(self, res, [subscribedUser], subscription);
            })
            .fail(function (err) {
                res.json(new JSend.error(err.message));
                if (self.loggingProvider) {
                    self.loggingProvider.info(err);
                }
            });
    };
    return {
        createNotifications: create,
        createNotificationsForUser: createForUser,
        signIn: signIn
    };
}());
module.exports = NotificationController;
