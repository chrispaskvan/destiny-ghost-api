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
var fs = require('fs'),
    path = require('path'),
    Q = require('q'),
    sqlite3 = require('sqlite3');
/**
 *
 * @param databaseFullPath
 * @constructor
 */
function Ghost() {
    'use strict';
    /**
     * @member - Full path of the local database.
     * @type {*|string}
     * @public
     */
    this.databaseFullPath = databaseFullPath || './databases/ghost.db';
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
    this.db = db;
}
/**
 * @namespace
 * @type {{createManifest, getLastManifest, getNextRefreshDate, getWorldDatabasePath, upsertVendor}}
 */
Ghost.prototype = (function () {
    'use strict';
    /**
     * Create manifest record in the database.
     * @param manifest {string}
     */
    var createManifest = function (manifest) {
        var sql = this.db.prepare('INSERT INTO DestinyManifestDefinition VALUES (?, ?)');
        sql.run(new Date().toISOString(), JSON.stringify(manifest));
        sql.finalize();
    };
    /**
     * Get the last recorded manifest from the database.
     * @returns {*|promise}
     */
    var getLastManifest = function () {
        var deferred = Q.defer();
        this.db.each('SELECT json FROM DestinyManifestDefinition ORDER BY id DESC LIMIT 1', function (err, row) {
            if (err) {
                deferred.reject(err);
            } else {
                deferred.resolve(JSON.parse(row.json));
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
     * Get the next refresh date for the vendor.
     * @param vendorHash
     * @returns {*|promise}
     */
    var getNextRefreshDate = function (vendorHash) {
        var deferred = Q.defer();
        if (vendorHash) {
            this.db.each('SELECT json FROM DestinyGhostVendor WHERE json LIKE \'%"vendorHash":' +
                vendorHash + '%\' ORDER BY id LIMIT 1', function (err, row) {
                    if (err) {
                        deferred.reject(err);
                    } else {
                        deferred.resolve(new Date(JSON.parse(row.json).nextRefreshDate));
                    }
                }, function (err) {
                    if (err) {
                        deferred.reject(err);
                    } else {
                        deferred.resolve();
                    }
                });
        } else {
            this.db.each('SELECT json FROM DestinyGhostVendor ORDER BY id LIMIT 1', function (err, row) {
                if (err) {
                    deferred.reject(err);
                } else {
                    deferred.resolve(new Date(JSON.parse(row.json).nextRefreshDate));
                }
            }, function (err) {
                if (err) {
                    deferred.reject(err);
                } else {
                    deferred.resolve();
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
        return this.getLastManifest()
            .then(function (lastManifest) {
                return lastManifest ?
                        path.join('./databases/', path.basename(lastManifest.mobileWorldContentPaths.en))
                        : undefined;
            });
    };
    /**
     *
     * @param vendor
     * @returns {*|promise}
     */
    var upsertVendor = function (vendor) {
        var self = this;
        var deferred = Q.defer();
        this.db.each('SELECT json FROM DestinyGhostVendor WHERE json LIKE \'%"vendorHash":' +
            vendor.vendorHash + '%\' LIMIT 1', function (err) {
                if (err) {
                    deferred.reject(err);
                } else {
                    self.db.run('UPDATE DestinyGhostVendor SET json = \'' + JSON.stringify(vendor) +
                        '\', id = \'' + vendor.nextRefreshDate +
                        '\' WHERE json LIKE \'%"vendorHash":' +
                        vendor.vendorHash + '%\'', function (err) {
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
                        var sql = self.db.prepare('INSERT INTO DestinyGhostVendor VALUES (?, ?)');
                        sql.run(vendor.nextRefreshDate, JSON.stringify(vendor));
                        sql.finalize();
                        deferred.resolve();
                    } else {
                        if (rows !== 1) {
                            deferred.reject(new Error('Hash, ' +
                                vendor.vendorHash + ', is not an unique identifier.'));
                        }
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
}());
module.exports = Ghost;
