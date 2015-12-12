/**
 * Created by chris on 9/29/15.
 */
'use strict';
var _ = require('underscore'),
    Destiny = require('../models/destiny'),
    fs = require('fs'),
    Ghost = require('../models/ghost'),
    jSend = require('../models/jsend'),
    path = require('path'),
    Q = require('q'),
    request = require('request'),
    User = require('../models/user'),
    World = require('../models/world'),
    yauzl = require('yauzl');

var destinyController = function () {
    var destiny;
    var ghost = new Ghost(process.env.DATABASE);
    var world;
    ghost.getWorldDatabasePath()
        .then(function (path) {
            world = new World(path);
        });
    var _getCookieValueByName = function (cookies, cookieName) {
        if (!(cookies && cookies.constructor === Array)) {
            return undefined;
        }
        return _.find(cookies, function (cookie) {
            return cookie.name === cookieName;
        }).value;
    };
    var _getMembershipId = function (displayName) {
        return Q.Promise(function (resolve, reject) {
            destiny.getMembershipIdFromDisplayName(displayName)
                .then(function (result) {
                    resolve(result);
                })
                .fail(function (err) {
                    reject(err);
                });
        });
    };
    var _getCharacters = function (membershipId) {
        return Q.promise(function (resolve, reject) {
            destiny.getCharacters(membershipId)
                .then(function (characters) {
                    world.open();
                    var characterPromises = _.map(characters, function (character) {
                        var deferred = Q.defer();
                        var characterBase = {
                            characterBase: {
                                characterId: character.characterBase.characterId,
                                emblem: character.emblemPath,
                                backgroundPath: character.backgroundPath,
                                powerLevel: character.characterBase.powerLevel
                            }
                        };
                        var itemHashes = _.map(character.characterBase.peerView.equipment, function (equipedItem) {
                            return equipedItem.itemHash;
                        });
                        var itemPromises = [];
                        _.each(itemHashes, function (itemHash) {
                            itemPromises.push(world.getItemByHash(itemHash));
                        });
                        Q.all(itemPromises)
                            .then(function (items) {
                                var equipment = _.map(_.filter(items, function (item) {
                                    return item !== undefined;
                                }), function (item) {
                                    return item.itemName;
                                });
                                characterBase.equipment = equipment;
                                world.getClassByHash(character.characterBase.classHash)
                                    .then(function (characterClass) {
                                        characterBase.className = characterClass.className;
                                        deferred.resolve(characterBase);
                                    })
                                    .fail(function (err) {
                                        reject(err);
                                    });
                            })
                            .fail(function (err) {
                                reject(err);
                            });
                        return deferred.promise;
                    });
                    Q.all(characterPromises)
                        .then(function (characters) {
                            world.close();
                            resolve(characters);
                        });
                });
        });
    };
    var _upsertManifest = function () {
        destiny.getManifest()
            .then(function (manifest) {
                ghost.getLastManifest()
                    .then(function (lastManifest) {
                        if (!lastManifest || lastManifest.version !== manifest.version) {
                            var databasePath = './database/';
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
                                                    world.setPath(entry.fileName);
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
                        } else {
                            world.setPath(path.join('./database/', path.basename(lastManifest.mobileWorldContentPaths.en)));
                        }
                    });
            });
    };
    var getFieldTestWeapons = function (req, res) {
        destiny.getFieldTestWeapons()
            .then(function (items) {
                if (items === undefined || items.length === 0) {
                    res.json(jSend.fail('Banshee-44 is the Gunsmith.'));
                    return;
                }
                var itemHashes = _.map(items, function (item) {
                    return item.item.itemHash;
                });
                world.open();
                var promises = [];
                _.each(itemHashes, function (itemHash) {
                    promises.push(world.getItemByHash(itemHash));
                });
                Q.all(promises)
                    .then(function (items) {
                        world.close();
                        res.json(_.map(items, function (item) {
                            return item.itemName;
                        }));
                    })
                    .fail(function (err) {
                        res.json(jSend.fail(err));
                    });
            })
            .fail(function (error) {
                res.json(jSend.fail(error));
            });
    };
    var getXur = function (req, res) {
        destiny.getXur()
            .then(function (items) {
                if (items === undefined || items.length === 0) {
                    res.status(200).json(jSend.fail('Xur is not available to take your call at this time.'));
                    return;
                }
                var itemHashes = _.map(items, function (item) {
                    return item.item.itemHash;
                });
                world.open();
                var promises = [];
                _.each(itemHashes, function (itemHash) {
                    promises.push(world.getItemByHash(itemHash));
                });
                Q.all(promises)
                    .then(function (items) {
                        world.close();
                        res.json(_.map(items, function (item) {
                            return item.itemName;
                        }));
                    })
                    .fail(function (err) {
                        res.json(jSend.fail(err));
                    });
            })
            .catch(function (error) {
                res.json(jSend.fail(error));
            });
    };
    var init = function (shadowUserConfiguration) {
        var shadowUser = JSON.parse(fs.readFileSync(shadowUserConfiguration));
        if (_getCookieValueByName(shadowUser.cookies, 'bungled') === undefined || _getCookieValueByName(shadowUser.cookies, 'bungledid') === undefined || _getCookieValueByName(shadowUser.cookies, 'bungleatk') === undefined) {
            var userModel = new User(process.env.DATABASE);
            userModel.signIn(shadowUser.userName, shadowUser.password)
                .then(function (cookies) {
                    shadowUser.cookies = cookies;
                    fs.writeFileSync(shadowUserConfiguration, JSON.stringify(shadowUser, null, 4));
                    destiny = new Destiny(shadowUser.apiKey, shadowUser.cookies);
                    _upsertManifest();
                });
        } else {
            destiny = new Destiny(shadowUser.apiKey, shadowUser.cookies);
            _upsertManifest();
        }
    };
    return {
        getFieldTestWeapons: getFieldTestWeapons,
        getXur: getXur,
        init: init
    };
};

module.exports = destinyController;
