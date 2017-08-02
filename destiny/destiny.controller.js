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
 * @requires Q
 * @requires request
 * @requires S
 * @requires User
 * @requires World
 * @requires yauzl
 */
var _ = require('underscore'),
    base64url = require('base64url'),
    cookie = require('cookie'),
    crypto = require('crypto'),
    fs = require('fs'),
    Ghost = require('../models/ghost'),
    jSend = require('../models/jsend'),
    Q = require('q'),
    request = require('request'),
    S = require('string'),
    yauzl = require('yauzl');

/**
 * @param loggingProvider
 * @constructor
 */
function DestinyController(destinyService, loggingProvider, userService, worldRepository) {
    'use strict';
    this.loggingProvider = loggingProvider;
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
    this.users = userService;
    /**
     * World Model
     * @type {World|exports|module.exports}
     */
    this.world = worldRepository;
}
/**
 * @namespace
 * @type {{getCharacters, getCurrentUser, getFieldTestWeapons, getFoundryOrders, getIronBannerEventRewards,
 * getXur, upsertManifest}}
 */
DestinyController.prototype = (function () {
    'use strict';
    /**
     *
     * @returns {*}
     * @private
     */
    var _getRandomState = function () {
        return base64url(crypto.randomBytes(11));
    };
    /**
     * Get the authorization URL for Bungie application.
     * @param req
     * @param res
     */
    var getAuthorizationUrl = function (req, res) {
        var self = this;
        var state = _getRandomState();

        req.session.state = state;
        return this.destiny.getAuthorizationUrl(state)
            .then(function (url) {
                res.send(url);
            })
            .fail(function (err) {
                res.json(jSend.error(err));
                if (self.loggingProvider) {
                    self.loggingProvider.info(err);
                }
            });
    };
    /**
     * Get characters for the current user.
     * @returns {*|Array}
     * @private
     */
    var getCharacters = function (req, res) {
        var self = this;

        this.users.getUserByDisplayName(req.session.displayName, req.session.membershipType)
            .then(function (currentUser) {
                return self.destiny.getCharacters(currentUser.membershipId, req.session.membershipType)
                    .then(function (characters) {
                        return self.ghost.getWorldDatabasePath()
                            .then(function (worldDatabasePath) {
                                self.world.open(worldDatabasePath);
                                var characterBases = _.map(characters, function (character) {
                                    return {
                                        characterId: character.characterBase.characterId,
                                        classHash: character.characterBase.classHash,
                                        emblem: character.emblemPath,
                                        backgroundPath: character.backgroundPath,
                                        powerLevel: character.characterBase.powerLevel,
                                        links: [
                                            {
                                                rel: 'Character',
                                                href: '/characters/' + character.characterBase.characterId
                                            }
                                        ]
                                    };
                                });
                                var promises = [];
                                _.each(characterBases, function (characterBase) {
                                    promises.push(self.world.getClassByHash(characterBase.classHash));
                                });
                                return Q.all(promises)
                                    .then(function (characterClasses) {
                                        self.world.close();
                                        _.each(characterBases, function (characterBase, index) {
                                            characterBase.className = characterClasses[index].className;
                                        });
                                        res.json(characterBases);
                                    });
                            });
                    });
            })
            .fail(function (err) {
                res.json(jSend.error(err));
                if (self.loggingProvider) {
                    self.loggingProvider.info(err);
                }
            });
    };
    /**
     * Get the currently available field test weapons from the gun smith.
     * @param req
     * @param res
     */
    var getFieldTestWeapons = function (req, res) {
        var self = this;

        this.users.getUserByDisplayName(req.session.displayName, req.session.membershipType)
            .then(function (currentUser) {
                var user = currentUser;

                return self.destiny.getCharacters(currentUser.membershipId, currentUser.membershipType)
                    .then(function (characters) {
                        return self.destiny.getFieldTestWeapons(characters[0].characterBase.characterId, user.bungie.accessToken.value)
                            .then(function (items) {
                                if (items === undefined || items.length === 0) {
                                    res.json(jSend.fail('Banshee-44 is the Gunsmith.'));
                                    return;
                                }
                                var itemHashes = _.map(items, function (item) {
                                    return item.item.itemHash;
                                });
                                return self.ghost.getWorldDatabasePath()
                                    .then(function (worldDatabasePath) {
                                        self.world.open(worldDatabasePath);
                                        var promises = [];
                                        _.each(itemHashes, function (itemHash) {
                                            promises.push(self.world.getItemByHash(itemHash));
                                        });
                                        return Q.all(promises)
                                            .then(function (items) {
                                                self.world.close();
                                                res.json(_.map(items, function (item) {
                                                    return item.itemName;
                                                }));
                                            });
                                    });
                            });
                    });
            })
            .fail(function (err) {
                res.json(jSend.error(err));
                if (self.loggingProvider) {
                    self.loggingProvider.info(err);
                }
            });
    };
    /**
     * Get the currently available field test weapons from the gun smith.
     * @param req
     * @param res
     */
    var getFoundryOrders = function (req, res) {
        var self = this;

        this.users.getUserByDisplayName(req.session.displayName, req.session.membershipType)
            .then(function (currentUser) {
                return self.destiny.getCharacters(currentUser.membershipId, currentUser.membershipType)
                    .then(function (characters) {
                        return self.destiny.getFoundryOrders(characters[0].characterBase.characterId, currentUser.bungie.accessToken.value)
                            .then(function (foundryOrders) {
                                if (foundryOrders.items.length === 0) {
                                    res.json(foundryOrders);
                                    return;
                                }
                                var itemHashes = _.map(foundryOrders.items, function (item) {
                                    return item.item.itemHash;
                                });
                                return self.ghost.getWorldDatabasePath()
                                    .then(function (worldDatabasePath) {
                                        self.world.open(worldDatabasePath);
                                        var promises = [];
                                        _.each(itemHashes, function (itemHash) {
                                            promises.push(self.world.getItemByHash(itemHash));
                                        });
                                        return Q.all(promises)
                                            .then(function (items) {
                                                self.world.close();
                                                res.json(_.map(items, function (item) {
                                                    return item.itemName;
                                                }));
                                            });
                                    });
                            });
                    });
            })
            .fail(function (err) {
                res.json(jSend.error(err));
                if (self.loggingProvider) {
                    self.loggingProvider.info(err);
                }
            });
    };
    /**
     * Get the currently available field test weapons from the gun smith.
     * @param req
     * @param res
     */
    var getIronBannerEventRewards = function (req, res) {
        var self = this;
        this.users.getUserByDisplayName(req.session.displayName, req.session.membershipType)
            .then(function (currentUser) {
                return self.destiny.getCharacters(currentUser.membershipId, req.session.membershipType)
                    .then(function (characters) {
                        var characterPromises = [];
                        _.each(characters, function (character) {
                            characterPromises.push(
                                self.destiny.getIronBannerEventRewards(character.characterBase.characterId, currentUser.bungie.accessToken.value)
                            );
                        });
                        return Q.all(characterPromises)
                            .then(function (characterItems) {
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
                                                self.world.close();
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
                                                }), armor: { hunter: _.map(hunterArmor, function (item) {
                                                    return item.itemName;
                                                }), titan: _.map(titanArmor, function (item) {
                                                    return item.itemName;
                                                }), warlock: _.map(warlockArmor, function (item) {
                                                    return item.itemName;
                                                })}});
                                            });
                                    });
                            });
                    });
            })
            .fail(function (err) {
                res.json(jSend.error(err));
                if (self.loggingProvider) {
                    self.loggingProvider.info(err);
                }
            });
    };
    /**
     * Get a Random Selection of Grimoire Cards
     * @param req
     * @param res
     * @returns {*}
     */
    var getGrimoireCards = function (req, res) {
        var self = this;
        var numberOfCards = parseInt(req.params.numberOfCards, 10);

        if (isNaN(numberOfCards)) {
            return res.status(422).end();
        }

        return self.ghost.getWorldDatabasePath()
            .then(function (worldDatabasePath) {
                self.world.open(worldDatabasePath);
                return self.world.getGrimoireCards(numberOfCards)
                    .then(function (grimoireCards) {
                        res.status(200).json(grimoireCards).end();
                    })
                    .fin(function () {
                        self.world.close();
                    });
            });
    };
    /**
     * Get the exotic weapons and gear available from Xur.
     * @param req
     * @param res
     */
    /*jslint unparam: true*/
    var getXur = function (req, res) {
        var self = this;

        return self.destiny.getXur()
            .then(function (vendor) {
                const { itemHashes, nextRefreshDate } = vendor;

                if (itemHashes === undefined || itemHashes.length === 0) {
                    res.status(200).json({ itemHashes: [], nextRefreshDate: nextRefreshDate });

                    return;
                }

                return self.ghost.getWorldDatabasePath()
                    .then(function (worldDatabasePath) {
                        var promises = [];

                        self.world.open(worldDatabasePath);

                        _.each(itemHashes, function (itemHash) {
                            promises.push(self.world.getItemByHash(itemHash));
                        });

                        return Q.all(promises)
                            .then(function (items) {
                                var itemPromises = _.map(items, function (item) {
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

                                return Q.all(itemPromises)
                                    .then(function (items) {
                                        res.json(items);
                                    });
                            })
                            .fin(function () {
                                self.world.close();
                            });
                    });
            })
            .fail(function (err) {
                res.status(500).send(err.message);
                if (self.loggingProvider) {
                    self.loggingProvider.info(err);
                }
            });
    };
    /*jslint unparam: false*/
    /**
     * Insert or update the Destiny manifest.
     */
    var upsertManifest = function () {
        var self = this;

        return this.destiny.getManifest()
            .then(function (manifest) {
                return self.ghost.getLastManifest()
                    .then(function (lastManifest) {
                        var databasePath = './databases/';
                        var relativeUrl = manifest.mobileWorldContentPaths.en;
                        var fileName = databasePath + relativeUrl.substring(relativeUrl.lastIndexOf('/') + 1);

                        if (!lastManifest || lastManifest.version !== manifest.version ||
                                lastManifest.mobileWorldContentPaths.en !== manifest.mobileWorldContentPaths.en ||
                                !fs.existsSync(fileName)) {
                            var file = fs.createWriteStream(fileName + '.zip');
                            var stream = request('https://www.bungie.net' + relativeUrl, function () {
                                /*
                                 * @todo Log entry here.
                                 */
                                console.log('Content downloaded from ' + relativeUrl);
                            }).pipe(file);
                            stream.on('finish', function decompress() {
                                yauzl.open(fileName + '.zip', function (err, zipFile) {
                                    if (!err) {
                                        zipFile.on('entry', function (entry) {
                                            zipFile.openReadStream(entry, function (err, readStream) {
                                                if (!err) {
                                                    readStream.pipe(fs.createWriteStream(databasePath + entry.fileName));
                                                    self.ghost.createManifest(manifest);
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
                if (self.loggingProvider) {
                    self.loggingProvider.info(err);
                }
            });
    };
    /**
     * @public
     */
    return {
        getAuthorizationUrl: getAuthorizationUrl,
        getCharacters: getCharacters,
        getFieldTestWeapons: getFieldTestWeapons,
        getFoundryOrders: getFoundryOrders,
        getIronBannerEventRewards: getIronBannerEventRewards,
        getGrimoireCards: getGrimoireCards,
        getXur: getXur,
        upsertManifest: upsertManifest
    };
}());
module.exports = DestinyController;
