/**
 * A module for creating tokens.
 *
 * @module Documents
 * @summary Helper class for interfacing with DocumentDB.
 * @author Chris Paskvan
 */
'use strict';
var DocumentClient = require('documentdb').DocumentClient,
    configuration = require('../settings/documents.json'),
    util = require('util');
/**
 * Get Collection by Id
 * @param collectionId
 * @returns {Promise.<*>}
 */
function getCollection(collectionId) {
    return new Promise((resolve, reject) => {
        function getCurrentCollection(err, collection) {
            if (err) {
                reject(err);
            }

            map[collectionId] = collection;

            resolve(collection);
        }

        function getCurrentDatabase(err, database) {
            if (err) {
                reject(err);
            }
            if (database) {
                client.queryCollections(database._self,
                    util.format('SELECT * FROM collections c WHERE c.id = "%s"', collectionId))
                    .current(getCurrentCollection);
            } else {
                resolve();
            }
        }

        if (map[collectionId]) {
            return resolve(map[collectionId]);
        }

        client.queryDatabases(util.format('SELECT * FROM root r WHERE r.id = "%s"', databaseId))
            .current(getCurrentDatabase);
    });
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
 * @returns {Promise}
 */
Documents.prototype.createDocument = function (collectionId, document) {
    return new Promise((resolve, reject) => {
        getCollection(collectionId)
            .then(collection => {
                if (collection) {
                    client.createDocument(collection._self, document,
                        (err, document) => err ? reject(err) : resolve(document.id));
                }
            });
    });
};
/**
 * Get Documents by Query
 * @param collectionId
 * @param query
 * @param options
 * @returns {Promise}
 */
Documents.prototype.getDocuments = function (collectionId, query, options) {
    return new Promise((resolve, reject) => {
        function getDocuments(err, results) {
            if (err) {
                reject(err);
            } else {
                resolve(results);
            }
        }

        getCollection(collectionId)
            .then(collection => {
                if (collection) {
                    client.queryDocuments(collection._self, query, options).toArray(getDocuments);
                }
            });
    });
};
/**
 * Insert If New or Update Existing Document
 * @param collectionId
 * @param document
 * @returns {Promise}
 */
Documents.prototype.upsertDocument = function (collectionId, document) {
    return new Promise((resolve, reject) => {
        getCollection(collectionId)
            .then(collection => {
                if (collection) {
                    client.upsertDocument(collection._self, document, err => err ? reject(err) : resolve());
                }
            });
    });
};

exports = module.exports = new Documents();
