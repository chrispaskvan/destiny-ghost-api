/**
 * A module for handling Destiny routes..
 */
var _ = require('underscore'),
    base64url = require('base64url'),
    crypto = require('crypto'),
    fs = require('fs'),
    Ghost = require('../helpers/ghost'),
    log = require('../helpers/log'),
    Q = require('q'),
    request = require('request'),
    S = require('string'),
    yauzl = require('yauzl');

class DestinyController {
    /**
     * @constructor
     * @param options
     */
    constructor(options) {
        this.destiny = options.destinyService;
        this.ghost = new Ghost({
            destinyService: options.destinyService
        });
        this.users = options.userService;
        this.world = options.worldRepository;
    }

    /**
     * Get a random state.
     * @returns {*}
     * @private
     */
    static _getRandomState() {
        return base64url(crypto.randomBytes(11));
    }

    /**
     * Get the authorization URL for Bungie application.
     * @param req
     * @param res
     */
    getAuthorizationUrl(req, res) {
        const state = this.constructor._getRandomState();

        req.session.state = state;
        this.destiny.getAuthorizationUrl(state)
            .then(url => res.send(url))
            .catch(err => {
                log.error(err);
                res.status(500).json(err);
            });
    }

    /**
     * Get characters for the current user.
     * @returns {*|Array}
     * @private
     */
    getCharacters(req, res) {
        const { session: { displayName, membershipType }} = req;

        this.ghost.getWorldDatabasePath()
            .then(worldDatabasePath => this.world.open(worldDatabasePath))
            .then(() => this.users.getUserByDisplayName(displayName, membershipType))
            .then(currentUser => this.destiny.getCharacters(currentUser.membershipId, membershipType))
            .then(characters => {
                const characterBases = characters.map(character =>  {
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

                let promises = [];
                characterBases.forEach(characterBase =>
                    promises.push(this.world.getClassByHash(characterBase.classHash)));

                return Promise.all(promises)
                    .then(characterClasses => {
                        this.world.close();
                        characterBases.forEach((characterBase, index) => {
                            characterBase.className = characterClasses[index].className;
                        });
                        res.json(characterBases);
                    });
            })
            .catch(err => {
                log.error(err);
                res.status(500).json(err);
            });
    }

    /**
     * Get the currently available field test weapons from the gun smith.
     * @param req
     * @param res
     */
    getFieldTestWeapons(req, res) {
        const { session: { displayName, membershipType }} = req;
        let accessToken;

        this.ghost.getWorldDatabasePath()
            .then(worldDatabasePath => this.world.open(worldDatabasePath))
            .then(() => this.users.getUserByDisplayName(displayName, membershipType))
            .then(currentUser => {
                accessToken = currentUser.bungie.accessToken.value;

                return this.destiny.getCharacters(currentUser.membershipId, membershipType);
            })
            .then(characters => {
                if (characters && characters.length > 0) {
                    const { characterBase: { characterId }} = characters[0];

                    return this.destiny.getFieldTestWeapons(characterId, accessToken)
                        .then(vendor => {
                            const { itemHashes } = vendor;
                            let promises = [];

                            itemHashes.forEach(itemHash => promises.push(this.world.getItemByHash(itemHash)));
                            return Promise.all(promises)
                                .then(items => {
                                    this.world.close();
                                    res.json(items.map(item => item.itemName));
                                });
                        });
                }

                return res.status(411).end();
            })
            .catch(err => {
                log.error(err);
                res.status(500).json(err);
            });
    }

    /**
     * Get the currently available field test weapons from the gun smith.
     * @param req
     * @param res
     */
    getFoundryOrders(req, res) {
        const { session: { displayName, membershipType }} = req;
        let accessToken;

        this.ghost.getWorldDatabasePath()
            .then(worldDatabasePath => this.world.open(worldDatabasePath))
            .then(() => this.users.getUserByDisplayName(displayName, membershipType))
            .then(currentUser => {
                accessToken = currentUser.bungie.accessToken.value;

                return this.destiny.getCharacters(currentUser.membershipId, membershipType);
            })
            .then(characters => {
                if (characters && characters.length > 0) {
                    const { characterBase: { characterId }} = characters[0];

                    return this.destiny.getFoundryOrders(characterId, accessToken)
                        .then(vendor => {
                            const { itemHashes } = vendor;
                            let promises = [];

                            itemHashes.forEach(itemHash => promises.push(this.world.getItemByHash(itemHash)));
                            return Promise.all(promises)
                                .then(items => {
                                    this.world.close();
                                    res.json(items.map(item => item.itemName));
                                });
                        });
                }

                return res.status(411).end();
            })
            .catch(err => {
                log.error(err);
                res.status(500).json(err);
            });
    }

    /**
     * Get the currently available field test weapons from the gun smith.
     * @param req
     * @param res
     */
    getIronBannerEventRewards(req, res) {
        var self = this;
        this.users.getUserByDisplayName(req.session.displayName, req.session.membershipType)
            .then(function (currentUser) {
                return self.destiny.getCharacters(currentUser.membershipId, req.session.membershipType)
                    .then(function (characters) {
                        var characterPromises = [];
                        _.each(characters, function (character) {
                            characterPromises.push(
                                self.destiny.getIronBannerEventRewards(character.characterBase.characterId,
                                    currentUser.bungie.accessToken.value)
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
            .fail(err => {
                log.error(err);
                res.status(500).json(err);
            });
    }

    /**
     * Get a Random Selection of Grimoire Cards
     * @param req
     * @param res
     * @returns {*}
     */
    getGrimoireCards(req, res) {
        const numberOfCards = parseInt(req.params.numberOfCards, 10);

        if (isNaN(numberOfCards)) {
            return res.status(422).end();
        }

        this.ghost.getWorldDatabasePath()
            .then(worldDatabasePath => {
                this.world.open(worldDatabasePath);

                return this.world.getGrimoireCards(numberOfCards)
                    .then(grimoireCards => res.status(200).json(grimoireCards).end())
                    .finally(() => this.world.close());
            })
            .catch(err => {
                log.error(err);
                res.status(500).json(err);
            });
    }

    /**
     * Get the exotic weapons and gear available from Xur.
     * @param req
     * @param res
     */
    getXur(req, res) {
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
                log.error(err);
                res.status(500).json(err);
            });
    }

    /**
     * Insert or update the Destiny manifest.
     */
    upsertManifest(req, res) {
        this.destiny.getManifest()
            .then(manifest => {
                return this.destiny.getManifest(true)
                    .then(lastManifest => {
                        const databasePath = './databases/';
                        const { mobileWorldContentPaths: { en: relativeUrl }}  = manifest;
                        const fileName = databasePath + relativeUrl.substring(relativeUrl.lastIndexOf('/') + 1);

                        if (!lastManifest || lastManifest.version !== manifest.version ||
                            lastManifest.mobileWorldContentPaths.en !== manifest.mobileWorldContentPaths.en ||
                            !fs.existsSync(fileName)) {
                            const file = fs.createWriteStream(fileName + '.zip');
                            const stream = request('https://www.bungie.net' + relativeUrl, () => {
                                log.info('content downloaded from ' + relativeUrl);
                            }).pipe(file);
                            stream.on('finish', () => {
                                yauzl.open(fileName + '.zip', (err, zipFile) => {
                                    if (!err) {
                                        zipFile.on('entry', entry => {
                                            zipFile.openReadStream(entry, (err, readStream) => {
                                                if (!err) {
                                                    readStream.pipe(fs.createWriteStream(databasePath + entry.fileName));

                                                    fs.unlink(fileName + '.zip');

                                                    res.status(200).json(manifest).end();
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
                        } else {
                            res.status(200).json(manifest).end();
                        }
                    });
            })
            .catch(err => {
                log.error(err);
                res.status(500).json(err);
            });
    }
}

module.exports = DestinyController;
