/**
 * Created by chris on 9/25/15.
 */
'use strict';
var _ = require('underscore'),
    fs = require('fs'),
    Q = require('q'),
    S = require('string'),
    sqlite3 = require('sqlite3');

var World = function (fileName) {
    var db;
    Object.defineProperty(this, 'fileName', {
        value: fileName,
        writable: false
    });
    var closeDatabase = function () {
        if (db) {
            db.close();
        }
    };
    var _getClasses = function () {
        var deferred = Q.defer();
        db.serialize(function () {
            var classes = [];
            db.each('SELECT json FROM DestinyClassDefinition', function (err, row) {
                if (err) {
                    throw err;
                }
                classes.push(JSON.parse(row.json));
            }, function (err) {
                if (err) {
                    throw err;
                }
                deferred.resolve(classes);
            });
        });
        return deferred.promise;
    };
    var getClassByHash = function (classHash) {
        _getClasses()
            .then(function (classes) {
                _.find(classes, function (characterClass) {
                    return characterClass.classHash === classHash;
                });
            });
    };
    var getClassByType = function (classType) {
        var deferred = Q.defer();
        _getClasses()
            .then(function (classes) {
                deferred.resolve(_.find(classes, function (characterClass) {
                    return characterClass.classType === classType;
                }));
            });
        return deferred.promise;
    };
    var getItemByName = function (itemName) {
        var deferred = Q.defer();
        db.serialize(function () {
            var items = [];
            var it = S(itemName).replaceAll('\'', '\'\'').s;
            db.each('SELECT json FROM DestinyInventoryItemDefinition WHERE json LIKE \'%"itemName":"%' + it + '%"%\'', function (err, row) {
                if (err) {
                    throw err;
                }
                items.push(JSON.parse(row.json));
            }, function (err, rows) {
                if (err) {
                    throw err;
                }
                if (rows === 0) {
                    deferred.resolve([]);
                }
                deferred.resolve(_.filter(items, function (item) {
                    return item.qualityLevel === 0;
                }));
            });
        });
        return deferred.promise;
    };
    var getItemByHash = function (itemHash) {
        var deferred = Q.defer();
        db.serialize(function () {
            db.each('SELECT json FROM DestinyInventoryItemDefinition WHERE json LIKE \'%"itemHash":' + itemHash + '%\' LIMIT 1', function (err, row) {
                if (err) {
                    throw err;
                }
                deferred.resolve(JSON.parse(row.json));
            }, function (err, rows) {
                if (err) {
                    throw err;
                }
                if (rows === 0) {
                    deferred.resolve();
                }
            });
        });
        return deferred.promise;
    };
    var getItemCategory = function (itemCategoryHash) {
        var deferred = Q.defer();
        db.serialize(function () {
            db.each('SELECT json FROM DestinyItemCategoryDefinition WHERE id = ' + itemCategoryHash, function (err, row) {
                if (err) {
                    throw err;
                }
                deferred.resolve(JSON.parse(row.json));
            }, function (err, rows) {
                if (err) {
                    throw err;
                }
                if (rows === 0) {
                    deferred.reject(new Error('No item category found for hash' + itemCategoryHash));
                }
            });
        });
        return deferred.promise;
    };

    var openDatabase = function (fileName) {
        fileName = fileName || this.fileName;
        if (!fs.existsSync(fileName)) {
            throw new Error('Database file not found.');
        }
        db = new sqlite3.Database(fileName);
    };
    var setPath = function (path) {
        this.fileName = path;
    };
    return {
        close: closeDatabase,
        getClassByHash: getClassByHash,
        getClassByType: getClassByType,
        getItemByName: getItemByName,
        getItemByHash: getItemByHash,
        getItemCategory: getItemCategory,
        open: openDatabase,
        setPath: setPath
    };
};

module.exports = World;
