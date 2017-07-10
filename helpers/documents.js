/**
 * A module for creating tokens.
 *
 * @module Documents
 * @summary Helper class for interfacing with DocumentDB.
 * @author Chris Paskvan
 */
'use strict';
var DocumentClient = require('documentdb').DocumentClient,
    Q = require('q'),
    util = require('util');

var databaseConfiguration = require('../settings/documents.json');

function Documents() {}

var databaseId = 'Gjallarhorn';
var client = new DocumentClient(databaseConfiguration.host, {
    masterKey: databaseConfiguration.authenticationKey
});
var map = Object.create(null);

Documents.prototype.createDocument = function (collectionId, document, callback) {
    var deferred = Q.defer();

    getCollection(collectionId)
        .then(function (collection) {
            if (collection) {
                client.createDocument(collection._self, document, function (err, document) {
                    if (err) {
                        return deferred.reject(err);
                    }

                    return deferred.resolve(document.id);
                });
            }
        })
        .fail(function (err) {
            deferred.reject(err);
        });

    return deferred.promise.nodeify(callback);
};
/**
 *
 * @param collectionId
 * @param callback
 * @returns {*}
 */
function getCollection(collectionId, callback) {
    var deferred = Q.defer();

    function getCurrentCollection(err, collection) {
        if (err) {
            return deferred.reject(err);
        }

        map[collectionId] = collection;
        return deferred.resolve(collection);
    }

    function getCurrentDatabase(err, database) {
        if (err) {
            return deferred.reject(err);
        }
        if (database) {
            // jscs:ignore requireCapitalizedComments
            // noinspection JSUnresolvedVariable
            client.queryCollections(database._self,
                    util.format('SELECT * FROM collections c WHERE c.id = "%s"', collectionId))
                .current(getCurrentCollection);
        } else {
            return deferred.resolve();
        }
    }

    var collection = map[collectionId];
    if (collection) {
        deferred.resolve(collection);
    } else {
        client.queryDatabases(util.format('SELECT * FROM root r WHERE r.id = "%s"', databaseId))
            .current(getCurrentDatabase);
    }

    return deferred.promise.nodeify(callback);
}

Documents.prototype.getDocuments = function (collectionId, query, options, callback) {
    var deferred = Q.defer();

    function getDocuments(err, results) {
        if (err) {
            deferred.reject(err);
        } else {
            deferred.resolve(results);
        }
    }

    getCollection(collectionId)
        .then(function (collection) {
            if (collection) {
                client.queryDocuments(collection._self, query, options).toArray(getDocuments);
            }
        })
        .fail(function (err) {
            deferred.reject(err);
        });

    return deferred.promise.nodeify(callback);
};

Documents.prototype.upsertDocument = function (collectionId, document, callback) {
    var deferred = Q.defer();

    getCollection(collectionId)
        .then(function (collection) {
            if (collection) {
                client.upsertDocument(collection._self, document, function (err) {
                    if (err) {
                        return deferred.reject(err);
                    }

                    return deferred.resolve();
                });
            }
        })
        .fail(function (err) {
            deferred.reject(err);
        });

    return deferred.promise.nodeify(callback);
};

exports = module.exports = new Documents();