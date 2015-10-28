/**
 * Created by chris on 9/25/15.
 */
var fs = require('fs'),
    Q = require('q'),
    sqlite3 = require('sqlite3');

var World = function () {
    var db;
    var _fileName;

    var closeDatabase = function () {
        if (db) {
            db.close();
        }
    };
    var getClass = function (classHash) {
        var deferred = Q.defer();
        db.serialize(function () {
            db.each("SELECT json FROM DestinyClassDefinition WHERE json LIKE '%" + classHash + "%' LIMIT 1", function (err, row) {
                deferred.resolve(JSON.parse(row.json));
            }, function (err, rows) {
                if (rows === 0) {
                    deferred.resolve();
                }
            });
        });
        return deferred.promise;
    };
    var getItem = function (itemHash) {
        var deferred = Q.defer();
        db.serialize(function () {
            db.each("SELECT json FROM DestinyInventoryItemDefinition WHERE json LIKE '%" + itemHash + "%' LIMIT 1", function (err, row) {
                deferred.resolve(JSON.parse(row.json));
            }, function (err, rows) {
                if (rows === 0) {
                    deferred.resolve();
                }
            });
        });
        return deferred.promise;
    };

    var openDatabase = function (fileName) {
        var fileName1 = fileName || _fileName;
        if (!fs.existsSync(fileName1)) {
            throw new Error("Database file not found.")
        }
        db = new sqlite3.Database(fileName1);
    };
    var setPath = function (path) {
        _fileName = path;
    }
    return {
        close: closeDatabase,
        getClass: getClass,
        getItem: getItem,
        open: openDatabase,
        setPath: setPath
    }
}

module.exports = World;
