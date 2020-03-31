/**
 * A module for interacting with Cosmos.
 *
 * @module Documents
 * @summary Helper class for interfacing with DocumentDB.
 * @author Chris Paskvan
 */
const { DocumentClient } = require('documentdb');
const util = require('util');
const { documents: { authenticationKey, databaseId, host } } = require('./config');

class Documents {
    constructor() {
        /**
         * Initialize Client
         * @type {*|DocumentClient}
         */
        this.client = new DocumentClient(host, {
            masterKey: authenticationKey,
        });
        /**
         * Local Cache
         * @type {object}
         */
        this.map = Object.create(null);
    }

    /**
     * Get collection by Id.
     *
     * @param collectionId
     * @returns {Promise}
     * @private
     */
    getCollection(collectionId) {
        return new Promise((resolve, reject) => {
            function getCurrentCollection(err, collection) {
                if (err) {
                    reject(err);
                }

                this.map[collectionId] = collection;

                resolve(collection);
            }

            function getCurrentDatabase(err, database) {
                if (err) {
                    reject(err);
                }
                if (database) {
                    this.client.queryCollections(database._self, // eslint-disable-line no-underscore-dangle, max-len
                        util.format('SELECT * FROM collections c WHERE c.id = "%s"', collectionId))
                        .current(getCurrentCollection.bind(this));
                } else {
                    resolve();
                }
            }

            if (this.map[collectionId]) {
                return resolve(this.map[collectionId]);
            }

            return this.client.queryDatabases(util.format('SELECT * FROM root r WHERE r.id = "%s"', databaseId))
                .current(getCurrentDatabase.bind(this));
        });
    }

    /**
     * Create a document.
     *
     * @param collectionId
     * @param document
     * @returns {Promise}
     */
    createDocument(collectionId, document) {
        return new Promise((resolve, reject) => {
            this.getCollection(collectionId)
                .then(collection => {
                    if (!collection) {
                        reject(new Error(`Collection ${collectionId} not found`));
                    }

                    this.client.createDocument(collection._self, document, // eslint-disable-line no-underscore-dangle, max-len
                        (err, document1) => (err ? reject(err) : resolve(document1.id)));
                });
        });
    }

    /**
     * Delete document by Id.
     *
     * @param collectionId
     * @param documentId
     * @param partitionKey
     * @returns {Promise}
     */
    deleteDocumentById(collectionId, documentId, partitionKey) {
        const documentUrl = `dbs/${databaseId}/colls/${collectionId}/docs/${documentId}`;

        return new Promise((resolve, reject) => {
            this.client.deleteDocument(documentUrl, {
                partitionKey: [partitionKey],
            }, (err, result) => {
                if (err) {
                    reject(err);
                }

                resolve(result);
            });
        });
    }

    /**
     * Get documents from a query.
     * @param collectionId
     * @param query
     * @param options
     * @returns {Promise}
     */
    getDocuments(collectionId, query, options) {
        return new Promise((resolve, reject) => {
            function getDocuments(err, results) {
                if (err) {
                    reject(err);
                }

                resolve(results);
            }

            this.getCollection(collectionId) // eslint-disable-line no-underscore-dangle
                .then(collection => {
                    if (!collection) {
                        reject(new Error(`Collection ${collectionId} not found`));
                    }

                    this.client.queryDocuments(collection._self, query, options).toArray(getDocuments); // eslint-disable-line no-underscore-dangle, max-len
                });
        });
    }

    /**
     * Insert if new or update an existing document.
     * @param collectionId
     * @param document
     * @returns {Promise}
     */
    upsertDocument(collectionId, document) {
        return new Promise((resolve, reject) => {
            this.getCollection(collectionId) // eslint-disable-line no-underscore-dangle
                .then(collection => {
                    if (!collection) {
                        reject(new Error(`Collection ${collectionId} not found`));
                    }

                    const options = {
                        accessCondition: {
                            type: 'IfMatch',
                            condition: document._etag, // eslint-disable-line no-underscore-dangle
                        },
                    };
                    this.client.upsertDocument(collection._self, document, options, err => (err ? reject(err) : resolve())); // eslint-disable-line no-underscore-dangle, max-len
                });
        });
    }
}

module.exports = new Documents();
