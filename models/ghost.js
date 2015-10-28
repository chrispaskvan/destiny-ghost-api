/**
 * Created by chris on 10/24/15.
 */
var fs = require('fs'),
    path = require('path'),
    Q = require('q'),
    sqlite3 = require('sqlite3');

var Ghost = function () {
    var fileName = "ghost.db";
    var databaseFolder = function () {
        return "./database";
    }
    var file = databaseFolder() + "/" + fileName;
    var exists = fs.existsSync(file);

    if(!exists) {
        console.log("Creating DB file.");
        fs.openSync(file, "w");
    }

    var db = new sqlite3.Database(file);
    db.serialize(function() {
        if(!exists) {
            db.run("CREATE TABLE DestinyManifestDefinition(id TEXT, json BLOB)");
        };
    });
    var createManifest = function (manifest) {
        var sql = db.prepare("INSERT INTO DestinyManifestDefinition VALUES (?, ?)");
        sql.run(new Date().toISOString(), JSON.stringify(manifest));
        sql.finalize();
    };
    var getLastManifest = function () {
        var deferred = Q.defer();
        db.each("SELECT json FROM DestinyManifestDefinition ORDER BY id DESC LIMIT 1", function (err, row) {
            deferred.resolve(JSON.parse(row.json));
        }, function(err, rows) {
            if (rows === 0) {
                deferred.resolve();
            }
        });
        return deferred.promise;
    };
    var getWorldDatabasePath = function () {
        getLastManifest()
            .then(function (lastManifest) {
                return lastManifest ? path.join("./database/", path.basename(lastManifest.mobileWorldContentPaths["en"])) : undefined;
            });
    };
    return {
        createManifest: createManifest,
        getLastManifest: getLastManifest,
        getWorldDatabasePath: getWorldDatabasePath
    }
};
module.exports = Ghost;
