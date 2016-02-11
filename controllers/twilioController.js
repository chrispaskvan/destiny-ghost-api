/**
 * A module for handling Twilio requests and responses.
 *
 * @module twilioController
 * @author Chris Paskvan
 * @requires _
 * @requires Bitly
 * @requires fs
 * @requires Ghost
 * @requires Notifications
 * @requires path
 * @requires Q
 * @requires twilio
 * @requires User
 * @requires World
 */
'use strict';
var _ = require('underscore'),
    /**
     * Bitly Model
     * @type {Bitly|exports|module.exports}
     */
    bitly = require('../models/bitly')(process.env.BITLY),
    Destiny = require('../models/destiny'),
    fs = require('fs'),
    Ghost = require('../models/ghost'),
    Notifications = require('../models/notifications'),
    path = require('path'),
    Q = require('q'),
    S = require('string'),
    shadowUser = require('../settings/ShadowUser.json'),
    twilio = require('twilio'),
    Users = require('../models/users'),
    World = require('../models/world');
/**
 * @constructor
 */
var twilioController = function () {
    /**
     * Destiny Model
     * @type {Destiny|exports|module.exports}
     */
    var destiny = new Destiny(shadowUser.apiKey);
    /**
     * Ghost Model
     * @type {Ghost|exports|module.exports}
     */
    var ghost = new Ghost(process.env.DATABASE);
    /**
     * World Model
     * @type {World|exports|module.exports}
     */
    var world = new World();
    /**
     * Notifications Model
     * @type {Notifications|exports|module.exports}
     */
    var notifications = new Notifications(process.env.DATABASE, process.env.TWILIO);
    /**
     * @member {Object}
     * @type {{accountSid: string, authToken string, phoneNumber string}} settings
     */
    var authToken = JSON.parse(fs.readFileSync(process.env.TWILIO || './settings/twilio.json')).authToken;
    /**
     * User Model
     * @type {User|exports|module.exports}
     */
    var userModel = new Users(process.env.DATABASE, process.env.TWILIO);
    var _getRandomResponseForAnError = function () {
        var responses = ['Sorry. I lost your message in the Ascendant realm. Blame Oryx.',
            'Skolas escaped the Prison of Elders again. He must be responsible for this mishap.',
            'Have you seen that fragment of Crota\'s soul laying around? Uh oh.',
            'Atheon\'s plugged into the power grid again. We\'re experiencing intermittent outages.'];
        return responses[Math.floor(Math.random() * responses.length)];
    };
    /**
     * Get a random response to reply when nothing was found.
     * @returns {string}
     * @private
     */
    var _getRandomResponseForNoResults = function () {
        var responses = ['Are you sure that\'s how it\'s spelled?',
            'Does it look like a Gjallarhorn?',
            'Sorry, I\'ve got nothing.'];
        return responses[Math.floor(Math.random() * responses.length)];
    };
    /**
     *
     * @returns {Request|*}
     * @private
     */
    var _getFieldTestWeapons = function () {
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
                                            var itemPromises = [];
                                            _.each(itemHashes, function (itemHash) {
                                                itemPromises.push(world.getItemByHash(itemHash));
                                            });
                                            return Q.all(itemPromises)
                                                .then(function (items) {
                                                    return _.map(items, function (item) {
                                                        return item.itemName;
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
     * @returns {Request|*}
     * @private
     */
    var _getFoundryOrders = function () {
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
                                            var itemPromises = [];
                                            _.each(itemHashes, function (itemHash) {
                                                itemPromises.push(world.getItemByHash(itemHash));
                                            });
                                            return Q.all(itemPromises)
                                                .then(function (items) {
                                                    return _.map(items, function (item) {
                                                        return item.itemName;
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
     * @param item {string}
     * @param world
     * @returns {*|promise}
     * @private
     */
    var _getItem = function (item, world) {
        var promises = [];
        _.each(item.itemCategoryHashes, function (itemCategoryHash) {
            promises.push(world.getItemCategory(itemCategoryHash));
        });
        return Q.all(promises)
            .then(function (itemCategories) {
                var itemCategory = _.reduce(_.sortBy(_.filter(itemCategories, function (itemCategory) {
                    return itemCategory.itemCategoryHash !== 0;
                }), function (itemCategory) {
                    return itemCategory.itemCategoryHash;
                }), function (memo, itemCategory) {
                    return memo + itemCategory.title + ' ';
                }, ' ').trim();
                return [{
                    itemCategory: itemCategory,
                    icon: 'https://www.bungie.net' + item.icon,
                    itemHash: item.itemHash,
                    itemName: item.itemName,
                    itemType: item.itemType,
                    tierTypeName: item.tierTypeName
                }];
            });
    };
    /**
     *
     * @param itemName
     * @returns {*|promise}
     */
    var _queryItem = function (itemName) {
        return ghost.getLastManifest()
            .then(function (lastManifest) {
                var worldPath = path.join('./databases/', path.basename(lastManifest.mobileWorldContentPaths.en));
                world.open(worldPath);
                return world.getItemByName(itemName)
                    .then(function (items) {
                        if (items.length > 0) {
                            if (items.length > 1) {
                                var groups = _.groupBy(items, function (item) {
                                    return item.itemName;
                                });
                                var keys = Object.keys(groups);
                                if (keys.length === 1) {
                                    return _getItem(items[0], world)
                                        .then(function (item) {
                                            return item;
                                        });
                                }
                                return items;
                            }
                            return _getItem(items[0], world)
                                .then(function (item) {
                                    return item;
                                });
                        }
                        return [];
                    })
                    .fin(function () {
                        world.close();
                    });
            });
    };
    /**
     *
     * @param itemHash
     * @returns {*|promise}
     */
    var _getItemByHash = function (itemHash) {
        return ghost.getLastManifest()
            .then(function (lastManifest) {
                var worldPath = path.join('./databases/', path.basename(lastManifest.mobileWorldContentPaths.en));
                world.open(worldPath);
                return world.getItemByHash(itemHash)
                    .then(function (item) {
                        return world.getClassByType(2)
                            .then(function (characterClass) {
                                return {
                                    classType: characterClass.className,
                                    icon: 'https://www.bungie.net' + item.icon,
                                    itemHash: itemHash,
                                    itemName: item.itemName,
                                    itemType: item.itemType,
                                    tierTypeName: item.tierTypeName
                                };
                            });
                    })
                    .fin(function () {
                        world.close();
                    });
            });
    };
    /**
     *
     * @returns {Request|*}
     * @private
     */
    var _getXur = function () {
        return ghost.getLastManifest()
            .then(function (lastManifest) {
                var worldPath = path.join('./databases/', path.basename(lastManifest.mobileWorldContentPaths.en));
                return destiny.getXur()
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
                            return Q.all(itemPromises)
                                .then(function (items) {
                                    return _.map(items, function (item) {
                                        return item.itemName;
                                    });
                                })
                                .fin(function () {
                                    world.close();
                                });
                        }
                        return [];
                    });
            });
    };
    /**
     *
     * @param req
     * @param res
     */
    var fallback = function (req, res) {
        var header = req.headers['x-twilio-signature'];
        var twiml = new twilio.TwimlResponse();
        if (twilio.validateRequest(authToken, header, process.env.DOMAIN + req.originalUrl, req.body)) {
            twiml.message(_getRandomResponseForAnError());
            res.writeHead(200, {
                'Content-Type': 'text/xml'
            });
        } else {
            res.writeHead(403, {
                'Content-Type': 'text/xml'
            });
        }
        res.end(twiml.toString());
    };
    /**
     *
     * @param req
     * @param res
     */
    var request = function (req, res) {
        var header = req.headers['x-twilio-signature'];
        var twiml = new twilio.TwimlResponse();
        if (twilio.validateRequest(authToken, header, process.env.DOMAIN + req.originalUrl, req.body)) {
            var counter = parseInt(req.cookies.counter, 10) || 0;
            var itemHash = req.cookies.itemHash;
            if (req.body.Body.trim().toLowerCase() === 'more') {
                if (itemHash) {
                    bitly.getShortUrl('http://db.planetdestiny.com/items/view/' + itemHash)
                        .then(function (shortUrl) {
                            twiml.message(shortUrl);
                            res.writeHead(200, {
                                'Content-Type': 'text/xml'
                            });
                            res.end(twiml.toString());
                        });
                } else {
                    twiml.message('More what?');
                    res.writeHead(200, {
                        'Content-Type': 'text/xml'
                    });
                    res.end(twiml.toString());
                }
            } else {
                if (counter > 25) {
                    twiml.message('Let me check with the Speaker regarding your Guardian status.');
                    res.writeHead(429, {
                        'Content-Type': 'text/xml'
                    });
                    res.end(twiml.toString());
                } else {
                    var searchTerm = req.body.Body.trim().toLowerCase();
                    if (searchTerm === 'xur') {
                        _getXur()
                            .then(function (exotics) {
                                var result = _.reduce(exotics, function (memo, exotic) {
                                    return memo + '\n' + exotic;
                                }, ' ').trim() || 'Xur is off conspiring with the 9. Check back Friday.';
                                twiml.message(result.substr(0, 130));
                                res.writeHead(200, {
                                    'Content-Type': 'text/xml'
                                });
                                res.end(twiml.toString());
                            });
                    } else if (searchTerm === 'field test weapons') {
                        _getFieldTestWeapons()
                            .then(function (fieldTestWeapons) {
                                var result = _.reduce(fieldTestWeapons, function (memo, weapon) {
                                    return memo + '\n' + weapon;
                                }, ' ').trim();
                                twiml.message(result.substr(0, 130));
                                res.writeHead(200, {
                                    'Content-Type': 'text/xml'
                                });
                                res.end(twiml.toString());
                            })
                            .fail(function (err) {
                                res.end(err.toString());
                            });
                    } else if (searchTerm === 'foundry orders') {
                        _getFoundryOrders()
                            .then(function (foundryOrders) {
                                var result = _.reduce(foundryOrders, function (memo, foundryItem) {
                                    return memo + '\n' + foundryItem;
                                }, ' ').trim();
                                twiml.message(result.substr(0, 130));
                                res.writeHead(200, {
                                    'Content-Type': 'text/xml'
                                });
                                res.end(twiml.toString());
                            })
                            .fail(function (err) {
                                res.end(err.toString());
                            });
                    } else {
                        _queryItem(searchTerm)
                            .then(function (items) {
                                counter = counter + 1;
                                res.cookie('counter', counter);
                                if (items.length === 1) {
                                    res.cookie('itemHash', items[0].itemHash);
                                    items[0].itemCategory = new S(items[0].itemCategory).strip('Weapon').collapseWhitespace().s.trim();
                                    var template = '{{itemName}} {{tierTypeName}} {{itemCategory}}';
                                    return userModel.getUserByPhoneNumber(req.body.From)
                                        .then(function (user) {
                                            if (user.type === 'landline') {
                                                twiml.message((new S(template).template(items[0]).s).substr(0, 130));
                                            } else {
                                                twiml.message(function () {
                                                    this.body(new S(template).template(items[0]).s)
                                                        .media(items[0].icon);
                                                });
                                            }
                                            res.writeHead(200, {
                                                'Content-Type': 'text/xml'
                                            });
                                            res.end(twiml.toString());
                                        });
                                } else if (items.length > 1) {
                                    var groups = _.groupBy(items, function (item) {
                                        return item.itemName;
                                    });
                                    var keys = Object.keys(groups);
                                    var result = _.reduce(keys, function (memo, key) {
                                        return memo + '\n' + key;
                                    }, ' ').trim();
                                    twiml.message(result.substr(0, 130));
                                    res.writeHead(200, {
                                        'Content-Type': 'text/xml'
                                    });
                                    res.end(twiml.toString());
                                } else {
                                    twiml.message(_getRandomResponseForNoResults());
                                    res.writeHead(200, {
                                        'Content-Type': 'text/xml'
                                    });
                                    res.end(twiml.toString());
                                }
                            })
                            .fail(function (err) {
                                res.end(err.toString());
                            });
                    }
                }
            }
        } else {
            res.writeHead(403);
            res.end();
        }
    };
    /**
     *
     * @param req
     * @param res
     */
    var statusCallback = function (req, res) {
        var header = req.headers['x-twilio-signature'];
        var twiml = new twilio.TwimlResponse();
        if (twilio.validateRequest(authToken, header, process.env.DOMAIN + req.originalUrl, req.body)) {
            setTimeout(notifications.updateMessage(req.body), 1000);
            res.writeHead(200, {
                'Content-Type': 'text/xml'
            });
        } else {
            res.writeHead(403, {
                'Content-Type': 'text/xml'
            });
        }
        res.end(twiml.toString());
    };
    return {
        fallback: fallback,
        request: request,
        statusCallback: statusCallback
    };
};

module.exports = twilioController;
