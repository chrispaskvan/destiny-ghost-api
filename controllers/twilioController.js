/**
 * Created by chris on 9/29/15.
 */
'use strict';
var _ = require('underscore'),
    Bitly = require('../models/Bitly'),
    fs = require('fs'),
    Ghost = require('../models/Ghost'),
    Notifications = require('../models/Notifications'),
    path = require('path'),
    Q = require('q'),
    S = require('string'),
    twilio = require('twilio'),
    User = require('../models/User'),
    World = require('../models/World');

var twilioController = function () {
    var ghost = new Ghost(process.env.DATABASE);
    var world;
    ghost.getWorldDatabasePath()
        .then(function (path) {
            world = new World(path);
        });
    var bitly = new Bitly(process.env.BITLY);
    var notifications = new Notifications(process.env.DATABASE, process.env.TWILIO);
    var authToken = JSON.parse(fs.readFileSync(process.env.TWILIO || './settings/twilio.json')).authToken;
    var userModel = new User(process.env.DATABASE, process.env.TWILIO);
    var _getRandomResponseForNoResults = function () {
        var responses = ['Are you sure that\'s how it\'s spelled?',
            'Does it look like a Gjallarhorn?',
            'Sorry, I\'ve got nothing.'];
        return responses[Math.floor(Math.random() * responses.length)];
    };
    var fallback = function (req, res) {
        var header = req.headers['x-twilio-signature'];
        var twiml = new twilio.TwimlResponse();
        if (twilio.validateRequest(authToken, header, process.env.DOMAIN + req.originalUrl, req.body)) {
            twiml.message('Sorry. Something went wrong. I blame Oryx.');
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
    var _getItem = function (item) {
        var deferred = Q.defer();
        var promises = [];
        _.each(item.itemCategoryHashes, function (itemCategoryHash) {
            promises.push(world.getItemCategory(itemCategoryHash));
        });
        Q.all(promises)
            .then(function (itemCategories) {
                world.close();
                var itemCategory = _.reduce(_.sortBy(_.filter(itemCategories, function (itemCategory) {
                    return itemCategory.itemCategoryHash !== 0;
                }), function (itemCategory) {
                    return itemCategory.itemCategoryHash;
                }), function (memo, itemCategory) {
                    return memo + itemCategory.title + ' ';
                }, ' ').trim();
                deferred.resolve([{
                    itemCategory: itemCategory,
                    icon: 'https://www.bungie.net' + item.icon,
                    itemHash: item.itemHash,
                    itemName: item.itemName,
                    itemType: item.itemType,
                    tierTypeName: item.tierTypeName
                }]);
            })
            .fail(function (err) {
                deferred.reject(err);
            });
        return deferred.promise;
    };
    var getItem = function (itemName) {
        var deferred = Q.defer();
        ghost.getLastManifest()
            .then(function (lastManifest) {
                var worldPath = path.join('./database/', path.basename(lastManifest.mobileWorldContentPaths.en));
                world.open(worldPath);
                world.getItemByName(itemName)
                    .then(function (items) {
                        if (items.length > 0) {
                            if (items.length > 1) {
                                var groups = _.groupBy(items, function (item) {
                                    return item.itemName;
                                });
                                var keys = Object.keys(groups);
                                if (keys.length === 1) {
                                    _getItem(items[0])
                                        .then(function (item) {
                                            deferred.resolve(item);
                                        });
                                } else {
                                    deferred.resolve(items);
                                }
                            } else {
                                _getItem(items[0])
                                    .then(function (item) {
                                        deferred.resolve(item);
                                    });
                            }
                        } else {
                            deferred.resolve([]);
                        }
                    });
            })
            .fail(function (error) {
                deferred.reject(error);
            });
        return deferred.promise;
    };
    var getItemByHash = function (itemHash) {
        var deferred = Q.defer();
        ghost.getLastManifest()
            .then(function (lastManifest) {
                var worldPath = path.join('./database/', path.basename(lastManifest.mobileWorldContentPaths.en));
                world.open(worldPath);
                world.getItemByHash(itemHash)
                    .then(function (item) {
                        world.getClassByType(2)
                            .then(function (characterClass) {
                                world.close();
                                deferred.resolve({
                                    classType: characterClass.className,
                                    icon: 'https://www.bungie.net' + item.icon,
                                    itemHash: itemHash,
                                    itemName: item.itemName,
                                    itemType: item.itemType,
                                    tierTypeName: item.tierTypeName
                                });
                            })
                            .fail(function (err) {
                                deferred.reject(err);
                            });
                    })
                    .fail(function (err) {
                        deferred.reject(err);
                    });
            })
            .fail(function (error) {
                deferred.reject(error);
            });
        return deferred.promise;
    };
    var request = function (req, res) {
        var header = req.headers['x-twilio-signature'];
        var twiml = new twilio.TwimlResponse();
        if (twilio.validateRequest(authToken, header, process.env.DOMAIN + req.originalUrl, req.body)) {
            var counter = parseInt(req.cookies.counter, 10) || 0;
            var itemHash = req.cookies.itemHash;
            if (itemHash && req.body.Body.trim().toUpperCase() === 'MORE') {
                bitly.getShortUrl('http://db.planetdestiny.com/items/view/' + itemHash)
                    .then(function (shortUrl) {
                        twiml.message(shortUrl);
                        res.writeHead(200, {
                            'Content-Type': 'text/xml'
                        });
                        res.end(twiml.toString());
                    });
            } else {
                if (counter > 121) {
                    twiml.message('Let me check with the Speaker regarding your standing with the Vanguard.');
                    res.writeHead(200, {
                        'Content-Type': 'text/xml'
                    });
                    res.end(twiml.toString());
                } else {
                    getItem(req.body.Body.trim())
                        .then(function (items) {
                            counter = counter + 1;
                            res.cookie('counter', counter);
                            if (items.length === 1) {
                                res.cookie('itemHash', items[0].itemHash);
                                var template = '{{itemName}} {{tierTypeName}} {{itemCategory}}';
                                userModel.getUserByPhoneNumber(req.body.From)
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
        } else {
            res.writeHead(403);
            res.end();
        }
    };
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
