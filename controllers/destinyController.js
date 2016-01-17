/**
 * A module for handling Destiny routes..
 *
 * @module destinyController
 * @author Chris Paskvan
 * @requires _
 * @requires Destiny
 * @requires fs
 * @requires Ghost
 * @requires jSend
 * @requires path
 * @requires Q
 * @requires request
 * @requires User
 * @requires World
 * @requires yauzl
 */
'use strict';
var _ = require('underscore'),
    cookie = require('cookie'),
    Destiny = require('../models/destiny'),
    fs = require('fs'),
    Ghost = require('../models/ghost'),
    jSend = require('../models/jsend'),
    path = require('path'),
    Q = require('q'),
    request = require('request'),
    shadowUser = require('../settings/ShadowUser.json'),
    World = require('../models/world'),
    yauzl = require('yauzl');

var destinyController = function () {
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
    var _getCookies = function (req) {
        var cookies = _.pick(cookie.parse(req.headers.cookie), 'bungled', 'bungledid', 'bungleatk');
        return _.map(_.keys(cookies), function (cookieName) {
            return {
                name: cookieName,
                value: cookies[cookieName]
            };
        });
    };
    /**
     * Get the value of the cookie given the name.
     * @param cookies {Array}
     * @param cookieName {string}
     * @returns {*|string}
     * @private
     */
    var _getCookieValueByName = function (cookies, cookieName) {
        if (!(cookies && cookies.constructor === Array)) {
            return undefined;
        }
        return _.find(cookies, function (cookie) {
            return cookie.name === cookieName;
        }).value;
    };
    /**
     * Get the Bungie membership number from the user display name.
     * @param displayName {string}
     * @returns {*|string}
     * @private
     */
    var _getMembershipId = function (displayName) {
        return destiny.getMembershipIdFromDisplayName(displayName)
            .then(function (result) {
                return result;
            });
    };
    /**
     * Get characters for the current user.
     * @returns {*|Array}
     * @private
     */
    var getCharacters = function (req, res) {
        var cookies = _getCookies(req);
        destiny.getCurrentUser(cookies)
            .then(function (currentUser) {
                return destiny.getCharacters(currentUser.membershipId)
                    .then(function (characters) {
                        return ghost.getWorldDatabasePath()
                            .then(function (worldDatabasePath) {
                                world.open(worldDatabasePath);
                                var characterBases = _.map(characters, function (character) {
                                    return {
                                        characterId: character.characterBase.characterId,
                                        classHash: character.characterBase.classHash,
                                        emblem: character.emblemPath,
                                        backgroundPath: character.backgroundPath,
                                        powerLevel: character.characterBase.powerLevel
                                    };
                                });
                                var promises = [];
                                _.each(characterBases, function (characterBase) {
                                    promises.push(world.getClassByHash(characterBase.classHash));
                                });
                                return Q.all(promises)
                                    .then(function (characterClasses) {
                                        world.close();
                                        _.each(characterBases, function (characterBase, index) {
                                            characterBase.className = characterClasses[index].className;
                                        });
                                        res.json(characterBases);
                                    });
                            });
                    });
            })
            .fail(function (err) {
                res.json(jSend.fail(err));
            });
    };
    /**
     *
     * @param req
     * @param res
     */
    var getCurrentUser = function (req, res) {
        var cookies = _getCookies(req);
        destiny.getCurrentUser(cookies)
            .then(function (currentUser) {
                res.json(currentUser.displayName);
            });
    };
    /**
     * Get the currently available field test weapons from the gun smith.
     * @param req
     * @param res
     */
    var getFieldTestWeapons = function (req, res) {
        var cookies = _getCookies(req);
        destiny.getCurrentUser(cookies)
            .then(function (currentUser) {
                return destiny.getCharacters(currentUser.membershipId)
                    .then(function (characters) {
                        return destiny.getFieldTestWeapons(characters[0].characterBase.characterId, cookies)
                            .then(function (items) {
                                if (items === undefined || items.length === 0) {
                                    res.json(jSend.fail('Banshee-44 is the Gunsmith.'));
                                    return;
                                }
                                var itemHashes = _.map(items, function (item) {
                                    return item.item.itemHash;
                                });
                                return ghost.getWorldDatabasePath()
                                    .then(function (worldDatabasePath) {
                                        world.open(worldDatabasePath);
                                        var promises = [];
                                        _.each(itemHashes, function (itemHash) {
                                            promises.push(world.getItemByHash(itemHash));
                                        });
                                        return Q.all(promises)
                                            .then(function (items) {
                                                world.close();
                                                res.json(_.map(items, function (item) {
                                                    return item.itemName;
                                                }));
                                            });
                                    });
                            });
                    });
            })
            .fail(function (err) {
                res.json(jSend.fail(err));
            });
    };
    /**
     * Get the currently available field test weapons from the gun smith.
     * @param req
     * @param res
     */
    var getFoundryOrders = function (req, res) {
        var cookies = _getCookies(req);
        destiny.getCurrentUser(cookies)
            .then(function (currentUser) {
                return destiny.getCharacters(currentUser.membershipId)
                    .then(function (characters) {
                        return destiny.getFoundryOrders(characters[0].characterBase.characterId, cookies)
                            .then(function (items) {
                                if (items === undefined || items.length === 0) {
                                    res.json(jSend.fail('Banshee-44 is the Gunsmith.'));
                                    return;
                                }
                                var itemHashes = _.map(items, function (item) {
                                    return item.item.itemHash;
                                });
                                return ghost.getWorldDatabasePath()
                                    .then(function (worldDatabasePath) {
                                        world.open(worldDatabasePath);
                                        var promises = [];
                                        _.each(itemHashes, function (itemHash) {
                                            promises.push(world.getItemByHash(itemHash));
                                        });
                                        return Q.all(promises)
                                            .then(function (items) {
                                                world.close();
                                                res.json(_.map(items, function (item) {
                                                    return item.itemName;
                                                }));
                                            });
                                    });
                            });
                    });
            })
            .fail(function (err) {
                res.json(jSend.fail(err));
            });
    };
    /**
     * Get the currently available field test weapons from the gun smith.
     * @param req
     * @param res
     */
    var getIronBannerEventRewards = function (req, res) {
        var cookies = _getCookies(req);
        destiny.getCurrentUser(cookies)
            .then(function (currentUser) {
                return destiny.getCharacters(currentUser.membershipId)
                    .then(function (characters) {
                        var characterPromises = [];
                        _.each(characters, function (character) {
                            characterPromises.push(destiny.getIronBannerEventRewards(character.characterBase.characterId, cookies));
                        });
                        return Q.all(characterPromises)
                            .then(function (characterItems) {
                                if (characterItems === undefined || characterItems.length === 0) {
                                    res.json(jSend.fail('Lord Saladin is not currently in the tower. The Iron Banner is unavailable.'));
                                    return;
                                }
                                var items = _.flatten(characterItems);
                                var itemHashes = _.uniq(_.map(items, function (item) {
                                    return item.item.itemHash;
                                }));
                                return ghost.getWorldDatabasePath()
                                    .then(function (worldDatabasePath) {
                                        world.open(worldDatabasePath);
                                        var promises = [];
                                        _.each(itemHashes, function (itemHash) {
                                            promises.push(world.getItemByHash(itemHash));
                                        });
                                        return Q.all(promises)
                                            .then(function (items) {
                                                world.close();
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
                                                res.json({ weapons: _.map(weapons, function (item) {
                                                    return item.itemName;
                                                }), armor: [{ hunter: _.map(hunterArmor, function (item) {
                                                    return item.itemName;
                                                }), titan: _.map(titanArmor, function (item) {
                                                    return item.itemName;
                                                }), warlock: _.map(warlockArmor, function (item) {
                                                    return item.itemName;
                                                })}]});
                                            });
                                    });
                            });
                    });
            })
            .fail(function (err) {
                res.json(jSend.fail(err));
            });
    };
    /**
     * @constant
     * @type {string}
     * @description Xur's Vendor Number
     */
    var xurHash = '2796397637';
    /**
     * Get the exotic weapons and gear available from Xur.
     * @param req
     * @param res
     */
    var getXur = function (req, res) {
        ghost.getNextRefreshDate(xurHash)
            .then(function (nextRefreshDate) {
                return destiny.getXur()
                    .then(function (items) {
                        if (items === undefined || items.length === 0) {
                            res.status(200).json({ items: [], nextRefreshDate: nextRefreshDate });
                            return;
                        }
                        var itemHashes = _.map(items, function (item) {
                            return item.item.itemHash;
                        });
                        return ghost.getWorldDatabasePath()
                            .then(function (worldDatabasePath) {
                                world.open(worldDatabasePath);
                                var promises = [];
                                _.each(itemHashes, function (itemHash) {
                                    promises.push(world.getItemByHash(itemHash));
                                });
                                return Q.all(promises)
                                    .then(function (items) {
                                        world.close();
                                        res.json(_.map(items, function (item) {
                                            return item.itemName;
                                        }));
                                    });
                            });
                    });
            })
            .fail(function (err) {
                res.json(jSend.fail(err));
            });
    };
    /**
     * Insert or update the Destiny manifest.
     */
    var upsertManifest = function () {
        destiny.getManifest()
            .then(function (manifest) {
                return ghost.getLastManifest()
                    .then(function (lastManifest) {
                        if (!lastManifest || lastManifest.version !== manifest.version ||
                                lastManifest.mobileWorldContentPaths.en !== manifest.mobileWorldContentPaths.en) {
                            var databasePath = './databases/';
                            var relativeUrl = manifest.mobileWorldContentPaths.en;
                            var fileName = databasePath + relativeUrl.substring(relativeUrl.lastIndexOf('/') + 1);
                            var file = fs.createWriteStream(fileName + '.zip');
                            var stream = request('https://www.bungie.net' + relativeUrl, function () {
                                // ToDo: A log entry here would be nice.
                                console.log('done1');
                            }).pipe(file);
                            stream.on('finish', function () {
                                yauzl.open(fileName + '.zip', function (err, zipFile) {
                                    if (!err) {
                                        zipFile.on('entry', function (entry) {
                                            zipFile.openReadStream(entry, function (err, readStream) {
                                                if (!err) {
                                                    readStream.pipe(fs.createWriteStream(databasePath + entry.fileName));
                                                    ghost.createManifest(manifest);
                                                    fs.unlink(fileName + '.zip');
                                                } else {
                                                    throw err;
                                                }
                                            });
                                        });
                                    } else {
                                        throw err;
                                    }
                                });
                            });
                        }
                    });
            })
            .fail(function (err) {
                /**
                 * @todo Log
                 */
            });
    };
    /**
     * @public
     */
    return {
        getCharacters: getCharacters,
        getCurrentUser: getCurrentUser,
        getFieldTestWeapons: getFieldTestWeapons,
        getFoundryOrders: getFoundryOrders,
        getIronBannerEventRewards: getIronBannerEventRewards,
        getXur: getXur,
        upsertManifest: upsertManifest
    };
};

module.exports = destinyController;
