/**
 * A module for interacting with Cosmos.
 *
 * @module Documents
 * @summary Helper class for interfacing with DocumentDB.
 * @author Chris Paskvan
 */
import configuration from './config';

const { documents: { databaseId } } = configuration;

class Documents {
    constructor(options = {}) {
        /**
         * Initialize Client
         * @type {*|DocumentClient}
         */
        this.client = options.client;
    }

    /**
     * Get collection by Id.
     *
     * @param collectionId
     * @returns {Promise}
     * @private
     */
    #getCollection(collectionId) {
        return Promise.resolve(this.client
            .database(databaseId)
            .container(collectionId));
    }

    /**
     * Create a document.
     *
     * @param collectionId
     * @param document
     * @returns {Promise}
     */
    async createDocument(collectionId, document) {
        const container = await this.#getCollection(collectionId);
        const { resource: createdDocument } = await container.items.create(document);

        return createdDocument;
    }

    /**
     * Delete document by Id.
     *
     * @param collectionId
     * @param documentId
     * @param partitionKey
     * @returns {Promise}
     */
    async deleteDocumentById(collectionId, documentId, partitionKey) {
        const container = await this.#getCollection(collectionId);
        const { resource: result } = await container.item(documentId, partitionKey).delete();

        return result;
    }

    /**
     * Get documents from a query.
     * @param collectionId
     * @param query
     * @param options
     * @returns {Promise}
     */
    async getDocuments(collectionId, query, options) {
        const container = await this.#getCollection(collectionId);
        const { resources: items } = await container.items
            .query(query, options)
            .fetchAll();

        return items;
    }

    /**
     * Insert if new or update an existing document.
     * @param collectionId
     * @param document
     * @returns {Promise}
     */
    async updateDocument(collectionId, document, partitionKey) {
        const container = await this.#getCollection(collectionId);
        const options = {
            accessCondition: {
                type: 'IfMatch',
                condition: document._etag, // eslint-disable-line no-underscore-dangle
            },
        };
        const { resource: updatedDocument } = await container
            .item(document.id, partitionKey, options)
            .replace(document);

        return updatedDocument;
    }
}

export default Documents;
