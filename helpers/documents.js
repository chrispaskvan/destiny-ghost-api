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
    configuration = require('../settings/documents.json'),
    util = require('util');
/**
 * Get Collection by Id
 * @param collectionId
 * @returns {promise}
 */
function getCollection(collectionId) {
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
            client.queryCollections(database._self,
                util.format('SELECT * FROM collections c WHERE c.id = "%s"', collectionId))
                .current(getCurrentCollection);
        } else {
            return deferred.resolve();
        }
    }

    if (map[collectionId]) {
        deferred.resolve(map[collectionId]);
    } else {
        client.queryDatabases(util.format('SELECT * FROM root r WHERE r.id = "%s"', databaseId))
            .current(getCurrentDatabase);
    }

    return deferred.promise;
}
/**
 *
 * @constructor
 */
function Documents() {}
/**
 * Database Id
 * @type {string}
 */
var databaseId = 'Gjallarhorn';
/**
 * Initialize Client
 * @type {*|DocumentClient}
 */
var client = new DocumentClient(configuration.host, {
    masterKey: configuration.authenticationKey
});
/**
 * Local Cache
 * @type {object}
 */
var map = Object.create(null);
/**
 * Create Document
 * @param collectionId
 * @param document
 * @returns {promise}
 */
Documents.prototype.createDocument = function (collectionId, document) {
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

    return deferred.promise;
};
/**
 * Get Documents by Query
 * @param collectionId
 * @param query
 * @param options
 * @returns {promise}
 */
Documents.prototype.getDocuments = function (collectionId, query, options) {
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

    return deferred.promise;
};
/**
 * Insert If New or Update Existing Document
 * @param collectionId
 * @param document
 * @returns {promise}
 */
Documents.prototype.upsertDocument = function (collectionId, document) {
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

    return deferred.promise;
};

exports = module.exports = new Documents();
