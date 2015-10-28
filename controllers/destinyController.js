/**
 * Created by chris on 9/29/15.
 */
var _ = require('underscore'),
    destiny = require('../models/Destiny')(),
    ghost = require('../models/Ghost')(),
    jSend = require('../models/JSend'),
    path = require('path'),
    Q = require('q'),
    storage = require('node-persist'),
    world = require('../models/World')(ghost.getWorldDatabasePath());

var fs = require('fs'),
request = require('request'), yauzl = require('yauzl');

var destinyController = function () {
    var _getIpAddress = function(req) {
        return req.headers['x-forwarded-for'] || req.connection.remoteAddress;
    };
    var _getMembershipId = function(ipAddress) {
        return Q.Promise(function(resolve, reject) {
            var displayName = storage.getItem(ipAddress);
            if (displayName) {
                var membershipId = storage.getItem(displayName);
                if (membershipId) {
                    resolve(membershipId);
                } else {
                    destiny.getMembershipIdFromDisplayName(displayName)
                        .then(function (result) {
                            resolve(result);
                        });
                }
            } else {
                reject("Please sign in.");
            }
        });
    };
    var _getCharacters = function (req, res) {
        destiny.getCharacters(req.membershipId)
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
                        itemPromises.push(world.getItem(itemHash));
                    });
                    Q.all(itemPromises)
                        .then(function (items) {
                            var equipment = _.map(_.filter(items, function (item) {
                                return item !== undefined;
                            }), function (item) {
                                return item.itemName;
                            });
                            characterBase.equipment = equipment;
                            world.getClass(character.characterBase.classHash)
                                .then(function (characterClass) {
                                    characterBase.className = characterClass.className;
                                    deferred.resolve(characterBase);
                                })
                                .fail(function (err) {
                                    res.json(jSend.fail(err));
                                });
                        })
                        .fail(function (err) {
                            res.json(jSend.fail(err));
                        });
                    return deferred.promise;
                });
                Q.all(characterPromises)
                    .then(function (characters) {
                        world.close();
                        res.status(200);
                        res.json(characters);
                });
            });
    };
    var getCharacters = function(req, res) {
        if (!req.membershipId) {
            _getMembershipId(_getIpAddress(req))
                .then(function (membershipId) {
                    req.membershipId = membershipId;
                    _getCharacters(req, res);
                })
                .fail(function (err) {
                    res.status(401).send(err);
                });
        } else {
            _getCharacters(req, res);
        }
    };
    var getFieldTestWeapons = function(req, res) {
        destiny.getFieldTestWeapons()
            .then(function (items) {
                if (items === undefined || items.length == 0) {
                    res.json(jSend.fail("Banshee-44 is the Gunsmith."));
                    return;
                }
                var itemHashes = _.map(items, function (item) {
                    return item.item.itemHash;
                });
                world.open();
                var promises = [];
                _.each(itemHashes, function (itemHash) {
                    promises.push(world.getItem(itemHash));
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
    var getXur = function (req, res) {
        destiny.getXur()
            .then(function (items) {
                if (items === undefined || items.length == 0) {
                    res.status(200).json(jSend.fail("Xur is not available to take your call at this time."));
                    return;
                }
                var itemHashes = _.map(items, function(item) {
                    return item.item.itemHash;
                });
                world.open();
                var promises = [];
                _.each(itemHashes, function (itemHash) {
                    promises.push(world.getItem(itemHash));
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
    var init = function () {
        destiny.getManifest()
            .then(function (manifest) {
                ghost.getLastManifest()
                    .then(function (lastManifest) {
                        if (!lastManifest || lastManifest.version !== manifest.version) {
                            var relativeUrl = manifest.mobileWorldContentPaths["en"];
                            var fileName = relativeUrl.substring(relativeUrl.lastIndexOf('/') + 1);
                            var file = fs.createWriteStream(fileName + ".zip");
                            var stream = request("https://www.bungie.net" + relativeUrl, function () {
                                // ToDo: A log entry here would be nice.
                                console.log("done1");
                            }).pipe(file);
                            stream.on('finish', function () {
                                yauzl.open(fileName + ".zip", function (err, zipFile) {
                                    if (err) {
                                        throw err;
                                    } else {
                                        zipFile.on("entry", function (entry) {
                                            zipFile.openReadStream(entry, function (err, readStream) {
                                                if (err) {
                                                    throw err;
                                                } else {
                                                    readStream.pipe(fs.createWriteStream(entry.fileName));
                                                    ghost.createManifest(manifest);
                                                    world.setPath(entry.fileName);
                                                }
                                            });
                                        });
                                    }
                                });
                            });
                        } else {
                            world.setPath(path.join("./database/", path.basename(lastManifest.mobileWorldContentPaths["en"])));
                        }
                    });
            });
    };
    return {
        getCharacters: getCharacters,
        getFieldTestWeapons: getFieldTestWeapons,
        getXur: getXur,
        init: init
    }
};

module.exports = destinyController;
