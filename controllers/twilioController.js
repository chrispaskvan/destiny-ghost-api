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
 * @requires S
 * @requires twilio
 * @requires User
 * @requires World
 */
var _ = require('underscore'),
    /**
     * Bitly Model
     * @type {Bitly|exports|module.exports}
     */
    bitly = require('../helpers/bitly'),
    Ghost = require('../helpers/ghost'),
    path = require('path'),
    Q = require('q'),
    S = require('string'),
    settings = require('../settings/twilio.' + (process.env.NODE_ENV || 'development') + '.json'),
    twilio = require('twilio'),
    World = require('../helpers/world');
/**
 * @constructor
 */
function TwilioController(destinyService, userService) {
    'use strict';
    /**
     * Destiny Model
     * @type {Destiny|exports|module.exports}
     */
    this.destiny = destinyService;
    /**
     * Ghost Model
     * @type {Ghost|exports|module.exports}
     */
    this.ghost = new Ghost(process.env.DATABASE);
    /**
     * World Model
     * @type {World|exports|module.exports}
     */
    this.world = World;
    /**
     * Notifications Model
     * @type {Notifications|exports|module.exports}
     */
    //this.notifications = new Notifications(process.env.DATABASE, process.env.TWILIO);
    /**
     * @member {Object}
     * @type {{accountSid: string, authToken string, phoneNumber string}} settings
     */
    this.authToken = settings.authToken;
    /**
     * User Model
     * @type {User|exports|module.exports}
     */
    this.users = userService;
}
/**
 * @namespace
 * @type {{fallback, request, statusCallback}}
 */
TwilioController.prototype = (function () {
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
     * @returns {string}
     * @private
     */
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
    var _getFieldTestWeapons = function (user) {
        var self = this;
        return this.ghost.getLastManifest()
            .then(function (lastManifest) {
                var worldPath = path.join('./databases/', path.basename(lastManifest.mobileWorldContentPaths.en));
                return self.destiny.getCharacters(user.membershipId, user.membershipType)
                    .then(function (characters) {
                        return self.destiny.getFieldTestWeapons(characters[0].characterBase.characterId,
                            user.bungie.accessToken.value)
                            .then(function (items) {
                                if (items && items.length > 0) {
                                    var itemHashes = _.map(items, function (item) {
                                        return item.item.itemHash;
                                    });
                                    self.world.open(worldPath);
                                    var itemPromises = [];
                                    _.each(itemHashes, function (itemHash) {
                                        itemPromises.push(self.world.getItemByHash(itemHash));
                                    });
                                    return Q.all(itemPromises)
                                        .then(function (items) {
                                            return self.world.getVendorIcon(gunSmithHash)
                                                .then(function (iconUrl) {
                                                    return {
                                                        items: _.map(items, function (item) {
                                                            return item.itemName;
                                                        }),
                                                        iconUrl: iconUrl
                                                    };
                                                });
                                        })
                                        .fin(function () {
                                            self.world.close();
                                        });
                                }
                            });
                    });
            });
    };
    /**
     *
     * @returns {Request|*}
     * @private
     */
    var _getFoundryOrders = function (shadowUser) {
        var self = this;
        return this.ghost.getLastManifest()
            .then(function (lastManifest) {
                var worldPath = path.join('./databases/', path.basename(lastManifest.mobileWorldContentPaths.en));
                return self.destiny.getCurrentUser(shadowUser.cookies)
                    .then(function (currentUser) {
                        return self.destiny.getCharacters(currentUser.membershipId, currentUser.membershipType)
                            .then(function (characters) {
                                return self.destiny.getFoundryOrders(characters[0].characterBase.characterId,
                                        shadowUser.cookies)
                                    .then(function (foundryOrders) {
                                        if (foundryOrders && foundryOrders.items && foundryOrders.items.length > 0) {
                                            var itemHashes = _.map(foundryOrders.items, function (item) {
                                                return item.item.itemHash;
                                            });
                                            self.world.open(worldPath);
                                            var itemPromises = [];
                                            _.each(itemHashes, function (itemHash) {
                                                itemPromises.push(self.world.getItemByHash(itemHash));
                                            });
                                            return Q.all(itemPromises)
                                                .then(function (items) {
                                                    return self.world.getVendorIcon(gunSmithHash)
                                                        .then(function (iconUrl) {
                                                            return {
                                                                items: _.map(items, function (item) {
                                                                    return item.itemName;
                                                                }),
                                                                iconUrl: iconUrl
                                                            };
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
    var _getIronBannerEventRewards = function (shadowUser) {
        var self = this;
        return this.destiny.getCurrentUser(shadowUser.cookies)
            .then(function (currentUser) {
                return self.destiny.getCharacters(currentUser.membershipId, currentUser.membershipType)
                    .then(function (characters) {
                        var characterPromises = [];
                        _.each(characters, function (character) {
                            characterPromises.push(
                                self.destiny.getIronBannerEventRewards(character.characterBase.characterId,
                                    shadowUser.cookies)
                            );
                        });
                        return Q.all(characterPromises)
                            .then(function (characterItems) {
                                if (characterItems === undefined || characterItems.length === 0) {
                                    return undefined;
                                }
                                var items = _.flatten(characterItems);
                                var itemHashes = _.uniq(_.map(items, function (item) {
                                    return item.item.itemHash;
                                }));
                                return self.ghost.getWorldDatabasePath()
                                    .then(function (worldDatabasePath) {
                                        self.world.open(worldDatabasePath);
                                        var promises = [];
                                        _.each(itemHashes, function (itemHash) {
                                            promises.push(self.world.getItemByHash(itemHash));
                                        });
                                        return Q.all(promises)
                                            .then(function (items) {
                                                return self.world.getVendorIcon(lordSaladinHash)
                                                    .then(function (iconUrl) {
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
                                                        return {
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
                                                    })
                                                    .fin(function () {
                                                        self.world.close();
                                                    });
                                            });
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
     * @returns {Request|*}
     * @private
     */
    var _getXur = function () {
        var self = this;
        return this.ghost.getLastManifest()
            .then(function (lastManifest) {
                var worldPath = path.join('./databases/', path.basename(lastManifest.mobileWorldContentPaths.en));
                self.world.open(worldPath);
                return self.world.getVendorIcon(xurHash)
                    .then(function (iconUrl) {
                        return self.destiny.getXur()
                            .then(function (items) {
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
                                            var promises = _.map(items, function (item) {
                                                if (item.itemName === 'Exotic Engram' ||
                                                        item.itemName === 'Legacy Engram') {
                                                    return self.world.getItemByHash(item.itemHash)
                                                        .then(function (itemDetail) {
                                                            return (new S(item.itemName).chompRight('Engram') +
                                                                itemDetail.itemTypeName);
                                                        });
                                                }
                                                var deferred = Q.defer();
                                                deferred.resolve(item.itemName);
                                                return deferred.promise;
                                            });
                                            return Q.all(promises)
                                                .then(function (items) {
                                                    return {
                                                        items: items,
                                                        iconUrl: iconUrl
                                                    };
                                                });
                                        });
                                }
                                return {
                                    items: [],
                                    iconUrl: iconUrl
                                };
                            });
                    })
                    .fin(function () {
                        self.world.close();
                    });
            });
    };
    /**
     * Search for an item that matches the name provided.
     * @param itemName
     * @returns {*|promise}
     */
    var _queryItem = function (itemName) {
        var self = this;
        return this.ghost.getLastManifest()
            .then(function (lastManifest) {
                var worldPath = path.join('./databases/', path.basename(lastManifest.mobileWorldContentPaths.en));
                self.world.open(worldPath);
                return self.world.getItemByName(itemName)
                    .then(function (items) {
                        if (items.length > 0) {
                            if (items.length > 1) {
                                var groups = _.groupBy(items, function (item) {
                                    return item.itemName;
                                });
                                var keys = Object.keys(groups);
                                if (keys.length === 1) {
                                    return _getItem(items[0], self.world)
                                        .then(function (item) {
                                            return item;
                                        });
                                }
                                return items;
                            }
                            return _getItem(items[0], self.world)
                                .then(function (item) {
                                    return item;
                                });
                        }
                        return [];
                    })
                    .fin(function () {
                        self.world.close();
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

        if (twilio.validateRequest(this.authToken, header, process.env.DOMAIN + req.originalUrl, req.body)) {
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
        var self = this;
        var header = req.headers['x-twilio-signature'];
        var twiml = new twilio.TwimlResponse();
        if (twilio.validateRequest(this.authToken, header, process.env.DOMAIN + req.originalUrl, req.body)) {
            var counter = parseInt(req.cookies.counter, 10) || 0;
            this.users.getUserByPhoneNumber(req.body.From)
                .then(function (user) {
                    if (!user || !user.dateRegistered) {
                        if (!req.cookies.isRegistered) {
                            twiml.message('Register your phone at app.destiny-ghost.com/register'); // ToDo: Domain name is hard coded here.
                            res.writeHead(200, {
                                'Content-Type': 'text/xml'
                            });
                            res.end(twiml.toString());
                        } else {
                            res.writeHead(403);
                            res.end();
                        }
                        return;
                    }
                    res.cookie('isRegistered', true);

                    var itemHash = req.cookies.itemHash;
                    var message = req.body.Body.trim().toLowerCase();
                    /**
                     * @todo Handle STOP and HELP
                     */
                    if (new S(message).startsWith('more')) {
                        if (itemHash) {
                            return bitly.getShortUrl('http://db.destinytracker.com/items/' + itemHash)
                                .then(function (planetDestinyShortUrl) {
                                    twiml.message('Destiny Tracker\n' + planetDestinyShortUrl);
                                    return bitly.getShortUrl('http://db.planetdestiny.com/items/view/' + itemHash)
                                        .then(function (destinyTrackerShortUrl) {
                                            twiml.message('Planet Destiny\n' + destinyTrackerShortUrl);
                                            res.writeHead(200, {
                                                'Content-Type': 'text/xml'
                                            });
                                            res.end(twiml.toString());
                                        });
                                });
                        }
                        twiml.message('More what?');
                        res.writeHead(200, {
                            'Content-Type': 'text/xml'
                        });
                        res.end(twiml.toString());
                    } else {
                        if (counter > 25) {
                            twiml.message('Let me check with the Speaker regarding your good standing as a Guardian.');
                            res.writeHead(429, {
                                'Content-Type': 'text/xml'
                            });
                            res.end(twiml.toString());
                        } else {
                            //var shadowUser = _.find(shadowUsers, function (shadowUser) {
                            //    return shadowUser.membershipType === user.membershipType;
                            //});
                            var searchTerm = req.body.Body.trim().toLowerCase();
                            switch (searchTerm) {
                                case 'xur': {
                                    return _getXur.call(self)
                                        .then(function (vendor) {
                                            var result = vendor.items && vendor.items.length > 0 ?
                                                _.reduce(vendor.items, function (memo, exotic) {
                                                    return memo + '\n' + exotic;
                                                }, ' ').trim() :
                                                'Xur is off conspiring with the 9. Check back Friday.';
                                            twiml.message(function () {
                                                this.body(result.substr(0, 130));
                                                this.media(vendor.iconUrl);
                                            });
                                            res.writeHead(200, {
                                                'Content-Type': 'text/xml'
                                            });
                                            res.end(twiml.toString());
                                        });

                                    break;
                                }
                                case 'field test weapons': {
                                    return _getFieldTestWeapons.call(self, user)
                                        .then(function (vendor) {
                                            var result = _.reduce(vendor.items, function (memo, weapon) {
                                                return memo + '\n' + weapon;
                                            }, ' ').trim();
                                            twiml.message(function () {
                                                this.body(result.substr(0, 130));
                                                this.media(vendor.iconUrl);
                                            });
                                            res.writeHead(200, {
                                                'Content-Type': 'text/xml'
                                            });
                                            res.end(twiml.toString());
                                        });

                                    break;
                                }
                                case 'foundry orders': {
                                    return _getFoundryOrders.call(self, user)
                                        .then(function (vendor) {
                                            var result = _.reduce(vendor.items, function (memo, foundryItem) {
                                                return memo + '\n' + foundryItem;
                                            }, ' ').trim();
                                            twiml.message(function () {
                                                this.body(result.substr(0, 130));
                                                this.media(vendor.iconUrl);
                                            });
                                            res.writeHead(200, {
                                                'Content-Type': 'text/xml'
                                            });
                                            res.end(twiml.toString());
                                        });

                                    break;
                                }
                                case 'iron banner': {
                                    return _getIronBannerEventRewards.call(self, user)
                                        .then(function (vendor) {
                                            if (vendor && vendor.rewards && vendor.rewards.weapons &&
                                                vendor.rewards.weapons.length > 0) {
                                                twiml.message(function () {
                                                    this.body(_.reduce(vendor.rewards.weapons, function (memo, weapon) {
                                                        return memo + '\n' + weapon;
                                                    }, ' ').trim().substr(0, 130));
                                                    this.media(vendor.iconUrl);
                                                });
                                                twiml.message('Hunter\n------\n' + _.reduce(vendor.rewards.armor.hunter,
                                                        function (memo, classArmor) {
                                                            return memo + '\n' + classArmor;
                                                        },
                                                        ' ').trim().substr(0, 130));
                                                twiml.message('Titan\n-----\n' + _.reduce(vendor.rewards.armor.titan,
                                                        function (memo, classArmor) {
                                                            return memo + '\n' + classArmor;
                                                        }, ' ').trim().substr(0, 130));
                                                twiml.message('Warlock\n-------\n' + _.reduce(vendor.rewards.armor.warlock,
                                                        function (memo, classArmor) {
                                                            return memo + '\n' + classArmor;
                                                        }, ' ').trim().substr(0, 130));
                                                res.writeHead(200, {
                                                    'Content-Type': 'text/xml'
                                                });
                                                res.end(twiml.toString());
                                            } else {
                                                twiml.message(function () {
                                                    this.body('Lord Saladin will be back soon enough.');
                                                    this.media(vendor.iconUrl);
                                                });
                                                res.writeHead(200, {
                                                    'Content-Type': 'text/xml'
                                                });
                                                res.end(twiml.toString());
                                            }
                                        });

                                    break;
                                }
                                default: {
                                    return _queryItem.call(self, searchTerm)
                                        .then(function (items) {
                                            counter = counter + 1;
                                            res.cookie('counter', counter);
                                            switch (items.length) {
                                                case 0: {
                                                    twiml.message(_getRandomResponseForNoResults());
                                                    res.writeHead(200, {
                                                        'Content-Type': 'text/xml'
                                                    });

                                                    return res.end(twiml.toString());
                                                }
                                                case 1: {
                                                    res.cookie('itemHash', items[0].itemHash);
                                                    items[0].itemCategory = new S(items[0].itemCategory).strip('Weapon')
                                                        .collapseWhitespace().s.trim();
                                                    var template = '{{itemName}} {{tierTypeName}} {{itemCategory}}';
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

                                                    return res.end(twiml.toString());
                                                }
                                                default: {
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

                                                    return res.end(twiml.toString());
                                                }
                                            }
                                        });
                                }
                            }
                        }
                    }
                })
                .fail(function (err) {
                    res.status(500).end(err.message);
                });
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
        if (twilio.validateRequest(this.authToken, header, process.env.DOMAIN + req.originalUrl, req.body)) {
            //this.notifications.updateMessage(JSON.stringify(req.body));
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
}());
module.exports = TwilioController;
