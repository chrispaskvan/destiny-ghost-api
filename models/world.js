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
    fs = require('fs'),
    Q = require('q'),
    S = require('string'),
    sqlite3 = require('sqlite3');
/**
 * @constructor
 */
function World() {
    'use strict';
    return this;
}
/**
 * @namespace
 * @type {{close, getClassByHash, getClassByType, getItemByName, getItemByHash, getItemCategory, getVendorIcon, open}}
 */
World.prototype = (function () {
    'use strict';
    /**
     * @function
     */
    var closeDatabase = function () {
        if (this.db) {
            this.db.close();
        }
    };
    /**
     * Get the Destiny class definitions.
     * @returns {*}
     * @private
     */
    var _getClasses = function () {
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
    };
    /**
     * Get the class according to the provided hash.
     * @param classHash {string}
     */
    var getClassByHash = function (classHash) {
        var deferred = Q.defer();
        _getClasses()
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
    var getClassByType = function (classType) {
        var deferred = Q.defer();
        this._getClasses()
            .then(function (classes) {
                deferred.resolve(_.find(classes, function (characterClass) {
                    return characterClass.classType === classType;
                }));
            });
        return deferred.promise;
    };
    /**
     * Look up the item(s) with matching strings in their name(s).
     * @param itemName {string}
     * @returns {*|Object}
     */
    var getItemByName = function (itemName) {
        var self = this;
        var deferred = Q.defer();
        this.db.serialize(function () {
            var items = [];
            var it = new S(itemName).replaceAll('\'', '\'\'').s;
            self.db.each('SELECT json FROM DestinyInventoryItemDefinition WHERE json LIKE \'%"itemName":"%' +
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
    var getItemByHash = function (itemHash) {
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
     * @returns {*}
     */
    var getItemCategory = function (itemCategoryHash) {
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
    var getVendorIcon = function (vendorHash) {
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
     * @param callback
     * @returns {*|promise}
     */
    var openDatabase = function (fileName, callback) {
        var deferred = Q.defer();
        if (!fs.existsSync(fileName)) {
            deferred.reject(new Error('Database file not found.'));
            return deferred.promise.nodeify(callback);
        }
        this.db = new sqlite3.Database(fileName, function () {
            deferred.resolve();
        });
        return deferred.promise.nodeify(callback);
    };
    return {
        close: closeDatabase,
        getClassByHash: getClassByHash,
        getClassByType: getClassByType,
        getItemByName: getItemByName,
        getItemByHash: getItemByHash,
        getItemCategory: getItemCategory,
        getVendorIcon: getVendorIcon,
        open: openDatabase
    };
}());
module.exports = World;
