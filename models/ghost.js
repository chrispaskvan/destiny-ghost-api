/**
 * A module for persisting user and other application data to a local database.
 *
 * @module Ghost
 * @summary Application database.
 * @author Chris Paskvan
 * @description CRUD operations for managing users, recording messages, and
 * tracking Destiny manifests.
 * @requires fs
 * @requires path
 * @requires Q
 * @requires sqlite3
 */
'use strict';
var fs = require('fs'),
    path = require('path'),
    Q = require('q'),
    sqlite3 = require('sqlite3');
/**
 *
 * @param databaseFullPath
 * @constructor
 */
var Ghost = function (databaseFullPath) {
    /**
     * @member - Full path of the local database.
     * @type {*|string}
     * @public
     */
    this.databaseFullPath = databaseFullPath || './database/ghost.db';
    if (!fs.existsSync(this.databaseFullPath)) {
        console.log('Creating database file.');
        fs.openSync(this.databaseFullPath, 'w');
    }
    /**
     * @type {sqlite3.Database}
     */
    var db = new sqlite3.Database(this.databaseFullPath);
    db.configure('busyTimeout', 2000);
    db.serialize(function () {
        db.run('CREATE TABLE IF NOT EXISTS DestinyManifestDefinition(id TEXT, json BLOB)');
        db.run('CREATE TABLE IF NOT EXISTS DestinyGhostVendor(id TEXT, json BLOB)');
    });
    /**
     * Create manifest record in the database.
     * @param manifest {string}
     */
    var createManifest = function (manifest) {
        var sql = db.prepare('INSERT INTO DestinyManifestDefinition VALUES (?, ?)');
        sql.run(new Date().toISOString(), JSON.stringify(manifest));
        sql.finalize();
    };
    /**
     * Get the last recorded manifest from the database.
     * @returns {*|promise}
     */
    var getLastManifest = function () {
        var deferred = Q.defer();
        db.each('SELECT json FROM DestinyManifestDefinition ORDER BY id DESC LIMIT 1', function (err, row) {
            if (err) {
                deferred.reject(err);
            } else {
                deferred.resolve(JSON.parse(row.json));
            }
        });
        return deferred.promise;
    };
    var getNextRefreshDate = function (vendorHash) {
        var deferred = Q.defer();
        if (vendorHash) {
            db.each('SELECT json FROM DestinyGhostVendor WHERE json LIKE \'%"vendorHash":' +
                vendorHash + '%\' ORDER BY id LIMIT 1', function (err, row) {
                    if (err) {
                        deferred.reject(err);
                    } else {
                        deferred.resolve(JSON.parse(row.json).nextRefreshDate);
                    }
                });
        } else {
            db.each('SELECT json FROM DestinyGhostVendor ORDER BY id LIMIT 1', function (err, row) {
                if (err) {
                    deferred.reject(err);
                } else {
                    deferred.resolve(JSON.parse(row.json).nextRefreshDate);
                }
            });
        }
        return deferred.promise;
    };
    /**
     * Get the full path to the database.
     * @returns {*|promise}
     */
    var getWorldDatabasePath = function () {
        return getLastManifest()
            .then(function (lastManifest) {
                return lastManifest ?
                        path.join('./database/', path.basename(lastManifest.mobileWorldContentPaths.en))
                        : undefined;
            });
    };
    var upsertVendor = function (vendor) {
        var deferred = Q.defer();
        db.each('SELECT json FROM DestinyGhostVendor WHERE json LIKE \'%"vendorHash":' +
            vendor.vendorHash + '%\' LIMIT 1', function (err) {
                if (err) {
                    deferred.reject(err);
                } else {
                    db.run('UPDATE DestinyGhostVendor SET json = \'' + JSON.stringify(vendor) +
                        '\', id = \'' + vendor.nextRefreshDate +
                        '\' WHERE json LIKE \'%"vendorHash":"' +
                        vendor.vendorHash + '"%\'', function (err) {
                            if (err) {
                                deferred.reject(err);
                            } else {
                                deferred.resolve();
                            }
                        });
                }
            }, function (err, rows) {
                if (err) {
                    deferred.reject(err);
                } else {
                    if (rows === 0) {
                        var sql = db.prepare('INSERT INTO DestinyGhostVendor VALUES (?, ?)');
                        sql.run(vendor.nextRefreshDate, JSON.stringify(vendor));
                        sql.finalize();
                        deferred.resolve();
                    } else {
                        deferred.reject(new Error('Hash, ' +
                            vendor.vendorHash + ', is not an unique identifier.'));
                    }
                }
            });
        return deferred.promise;
    };
    return {
        createManifest: createManifest,
        getLastManifest: getLastManifest,
        getNextRefreshDate: getNextRefreshDate,
        getWorldDatabasePath: getWorldDatabasePath,
        upsertVendor: upsertVendor
    };
};
module.exports = Ghost;
