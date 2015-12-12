/**
 * Created by chris on 10/9/15.
 */
'use strict';
var _ = require('underscore'),
    AuthenticationController = require('../controllers/authenticationController'),
    Destiny = require('../models/Destiny'),
    fs = require('fs'),
    Ghost = require('../models/Ghost'),
    Notifications = require('../models/Notifications'),
    path = require('path'),
    Q = require('q'),
    User = require('../models/User'),
    World = require('../models/World');

var CronJob = require('cron').CronJob;

var notificationController = function (shadowUserConfiguration) {
    var destiny;
    var ghost = new Ghost(process.env.DATABASE);
    var notifications = new Notifications(process.env.DATABASE, process.env.TWILIO);
    var world;
    ghost.getWorldDatabasePath()
        .then(function (path) {
            world = new World(path);
        });
    var userModel = new User(process.env.DATABASE);
    shadowUserConfiguration = shadowUserConfiguration || './settings/ShadowUser.json';
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
                                                        notifications.sendMessage('The foundry is accepting orders for...\n' + _.reduce(_.map(items, function (item) {
                                                                return item.itemName;
                                                            }), function (memo, itemName) {
                                                                return memo + itemName + '\n';
                                                            }, ' ').trim(), user.phoneNumber);
                                                    });
                                                });
                                        }
                                    })
                                    .fail(function (err) {
                                        if (err.code === 99 && !isSecondAttempt) {
                                            var authenticationContoller = new AuthenticationController();
                                            authenticationContoller.signIn(userName, password)
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
                                        notifications.sendMessage('Xur has arrived... for now...\n' + _.reduce(_.map(items, function (item) {
                                            return item.itemName;
                                        }), function (memo, itemName) {
                                            return memo + itemName + '\n';
                                        }, ' ').trim(), user.phoneNumber);
                                    });
                                });
                        } else {
                            _.each(users, function (user) {
                                notifications.sendMessage('Xur hasn\'t opened shop yet.', user.phoneNumber);
                            });
                        }
                    })
                    .fail(function (err) {
                        throw err;
                    });
            });
    };
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
                }
            });
    };
    var init = function () {
        var shadowUser = JSON.parse(fs.readFileSync(shadowUserConfiguration));
        if (_getCookieValueByName(shadowUser.cookies, 'bungled') === undefined || _getCookieValueByName(shadowUser.cookies, 'bungledid') === undefined || _getCookieValueByName(shadowUser.cookies, 'bungleatk') === undefined) {
            var userModel = new User(process.env.DATABASE);
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
