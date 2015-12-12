/**
 * Created by chris on 10/24/15.
 */
'use strict';
var fs = require('fs'),
    path = require('path'),
    Q = require('q'),
    sqlite3 = require('sqlite3');

var Ghost = function (databaseFullPath) {
    this.databaseFullPath = databaseFullPath || './database/ghost.db';
    if (!fs.existsSync(this.databaseFullPath)) {
        console.log('Creating database file.');
        fs.openSync(this.databaseFullPath, 'w');
    }
    var db = new sqlite3.Database(this.databaseFullPath);
    db.configure('busyTimeout', 2000);
    db.serialize(function () {
        db.run('CREATE TABLE IF NOT EXISTS DestinyManifestDefinition(id TEXT, json BLOB)');
    });
    var createManifest = function (manifest) {
        var sql = db.prepare('INSERT INTO DestinyManifestDefinition VALUES (?, ?)');
        sql.run(new Date().toISOString(), JSON.stringify(manifest));
        sql.finalize();
    };
    var getLastManifest = function () {
        var deferred = Q.defer();
        db.each('SELECT json FROM DestinyManifestDefinition ORDER BY id DESC LIMIT 1', function (err, row) {
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
        return deferred.promise;
    };
    var getWorldDatabasePath = function () {
        return getLastManifest()
            .then(function (lastManifest) {
                return lastManifest ?
                    path.join('./database/', path.basename(lastManifest.mobileWorldContentPaths.en))
                    : undefined;
            });
    };
    return {
        createManifest: createManifest,
        getLastManifest: getLastManifest,
        getWorldDatabasePath: getWorldDatabasePath
    };
};
module.exports = Ghost;
