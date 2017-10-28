/**
 * A module for interacting with Cosmos.
 *
 * @module Documents
 * @summary Helper class for interfacing with DocumentDB.
 * @author Chris Paskvan
 */
const DocumentClient = require('documentdb').DocumentClient,
    { authenticationKey, databaseId, host } = require('../settings/documents.json'),
    util = require('util');

class Documents {
    constructor() {
		/**
		 * Initialize Client
		 * @type {*|DocumentClient}
		 */
		this.client = new DocumentClient(host, {
			masterKey: authenticationKey
		});
		/**
		 * Local Cache
		 * @type {object}
		 */
		this.map = Object.create(null);
    }

	/**
     * Get collection by Id.
	 * @param collectionId
	 * @returns {Promise}
	 * @private
	 */
	_getCollection(collectionId) {
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
					this.client.queryCollections(database._self,
						util.format('SELECT * FROM collections c WHERE c.id = "%s"', collectionId))
							.current(getCurrentCollection.bind(this));
				} else {
					resolve();
				}
			}

			if (this.map[collectionId]) {
				return resolve(this.map[collectionId]);
			}

			this.client.queryDatabases(util.format('SELECT * FROM root r WHERE r.id = "%s"', databaseId))
				.current(getCurrentDatabase.bind(this));
		});
	}

	/**
	 * Create a document.
	 * @param collectionId
	 * @param document
	 * @returns {Promise}
	 */
	createDocument(collectionId, document) {
		return new Promise((resolve, reject) => {
			this._getCollection(collectionId)
				.then(collection => {
					if (collection) {
						this.client.createDocument(collection._self, document,
							(err, document) => err ? reject(err) : resolve(document.id));
					}
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
				} else {
					resolve(results);
				}
			}

			this._getCollection(collectionId)
				.then(collection => {
					if (collection) {
						this.client.queryDocuments(collection._self, query, options).toArray(getDocuments);
					}
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
			this._getCollection(collectionId)
				.then(collection => {
					if (collection) {
						this.client.upsertDocument(collection._self, document, err => err ? reject(err) : resolve());
					}
				});
		});
	}
}

module.exports = new Documents();
