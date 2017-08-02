/**
 * A module for accessing the Destiny World database.
 *
 * @module World
 * @summary Destiny World database.
 * @author Chris Paskvan
 * @requires _
 * @requires fs
 * @requires Q
 * @requires S
 * @requires sqlite3
 */
var _ = require('underscore'),
    Q = require('q'),
    S = require('string'),
    fs = require('fs'),
    sqlite3 = require('sqlite3');
/**
 * Get the Destiny class definitions.
 * @returns {*}
 * @private
 */
function getClasses() {
    var self = this;
    var deferred = Q.defer();

    this.db.serialize(function () {
        var classes = [];

        self.db.each('SELECT json FROM DestinyClassDefinition', function (err, row) {
            if (err) {
                deferred.reject(err);
            } else {
                classes.push(JSON.parse(row.json));
            }
        }, function (err) {
            if (err) {
                deferred.reject(err);
            } else {
                deferred.resolve(classes);
            }
        });
    });

    return deferred.promise;
}
/**
 * @constructor
 */
function World() {}
/**
 * Close the Connection
 */
World.prototype.close = function () {
    if (this.db) {
        this.db.close();
    }
};
/**
 * Get the class according to the provided hash.
 * @param classHash {string}
 */
World.prototype.getClassByHash = function (classHash) {
    var deferred = Q.defer();

    getClasses.call(this)
        .then(function (classes) {
            deferred.resolve(_.find(classes, function (characterClass) {
                return characterClass.classHash === classHash;
            }));
        });

    return deferred.promise;
};
/**
 * Get the class by the type provided.
 * @param classType {string}
 * @returns {*}
 */
World.prototype.getClassByType = function (classType) {
    var deferred = Q.defer();

    getClasses.call(this)
        .then(function (classes) {
            deferred.resolve(_.find(classes, function (characterClass) {
                return characterClass.classType === classType;
            }));
        });

    return deferred.promise;
};
/**
 * Get a Random Number of Cards
 * @param numberOfCards {integer}
 * @returns {promise}
 */
World.prototype.getGrimoireCards = function (numberOfCards) {
    var self = this;
    var deferred = Q.defer();

    this.db.serialize(function () {
        var cards = [];

        self.db.each('SELECT * FROM DestinyGrimoireCardDefinition WHERE id IN (SELECT id FROM DestinyGrimoireCardDefinition ORDER BY RANDOM() LIMIT ' + // jscs:ignore maximumLineLength
                numberOfCards + ')', function (err, row) {
            if (err) {
                deferred.reject(err);
            } else {
                cards.push(JSON.parse(row.json));
            }
        }, function (err) {
            if (err) {
                deferred.reject(err);
            } else {
                deferred.resolve(cards);
            }
        });
    });

    return deferred.promise;
};
/**
 * Look up the item(s) with matching strings in their name(s).
 * @param itemName {string}
 * @returns {promise}
 */
World.prototype.getItemByName = function (itemName) {
    var self = this;
    var deferred = Q.defer();

    this.db.serialize(function () {
        var items = [];
        var it = new S(itemName).replaceAll('\'', '\'\'').s;
        self.db.each('SELECT json FROM DestinyInventoryItemDefinition WHERE json LIKE \'%"itemName":"' +
            it + '%"%\'', function (err, row) {
                if (err) {
                    deferred.reject(err);
                }
                items.push(JSON.parse(row.json));
            }, function (err, rows) {
                if (err) {
                    deferred.reject(err);
                } else {
                    if (rows === 0) {
                        deferred.resolve([]);
                    } else {
                        var groups = _.groupBy(items, function (item) {
                            return item.itemName;
                        });
                        var keys = Object.keys(groups);
                        deferred.resolve(_.map(keys, function (key) {
                            return _.min(_.filter(items, function (item) {
                                return item.itemName === key;
                            }), function (item) {
                                return item.qualityLevel;
                            });
                        }));
                    }
                }
            });
    });

    return deferred.promise;
};
/**
 * Get item by the hash provided.
 * @param itemHash
 * @returns {*}
 */
World.prototype.getItemByHash = function (itemHash) {
    var self = this;
    var deferred = Q.defer();

    this.db.serialize(function () {
        self.db.each('SELECT json FROM DestinyInventoryItemDefinition WHERE json LIKE \'%"itemHash":' +
            itemHash + '%\' LIMIT 1', function (err, row) {
                if (err) {
                    deferred.reject(err);
                } else {
                    deferred.resolve(JSON.parse(row.json));
                }
            });
    });

    return deferred.promise;
};
/**
 * Get the category definition for the provided hash.
 * @param itemCategoryHash
 * @returns {promise}
 */
World.prototype.getItemCategory = function (itemCategoryHash) {
    var self = this;
    var deferred = Q.defer();

    this.db.serialize(function () {
        self.db.each('SELECT json FROM DestinyItemCategoryDefinition WHERE id = ' +
            itemCategoryHash, function (err, row) {
                if (err) {
                    deferred.reject(err);
                } else {
                    deferred.resolve(JSON.parse(row.json));
                }
            }, function (err, rows) {
                if (err) {
                    deferred.reject(err);
                } else {
                    if (rows === 0) {
                        deferred.reject(new Error('No item category found for hash' +
                            itemCategoryHash));
                    } else {
                        deferred.reject(new Error('Hash, ' +
                            itemCategoryHash + ', is not an unique identifier.'));
                    }
                }
            });
    });

    return deferred.promise;
};
/**
 *
 * @param vendorHash
 * @returns {*|promise}
 */
World.prototype.getVendorIcon = function (vendorHash) {
    var deferred = Q.defer();

    this.db.each('SELECT json FROM DestinyVendorDefinition WHERE json LIKE \'%"vendorHash":' +
        vendorHash + '%\' ORDER BY id LIMIT 1', function (err, row) {
            if (err) {
                deferred.reject(err);
            } else {
                deferred.resolve('https://www.bungie.net' + JSON.parse(row.json).summary.vendorIcon);
            }
        }, function (err) {
            if (err) {
                deferred.reject(err);
            } else {
                deferred.resolve();
            }
        });

    return deferred.promise;
};
/**
 *
 * @param fileName
 * @returns {promise}
 */
World.prototype.open = function (fileName) {
    var deferred = Q.defer();

    if (!fs.existsSync(fileName)) {
        deferred.reject(new Error('Database file not found.'));
        return deferred.promise.nodeify(callback);
    }
    this.db = new sqlite3.Database(fileName, function () {
        deferred.resolve();
    });

    return deferred.promise;
};

exports = module.exports = new World();
