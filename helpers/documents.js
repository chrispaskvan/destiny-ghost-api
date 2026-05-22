// @ts-check
/**
 * A module for interacting with Cosmos.
 *
 * @module Documents
 * @summary Helper class for interfacing with DocumentDB.
 * @author Chris Paskvan
 */
import configuration from './config.js';

const {
    documents: { databaseId },
} = configuration;

/**
 * Cosmos DB system properties present on every stored document.
 * @typedef {Object} CosmosSystemProperties
 * @property {string} id - Document ID (user-supplied or auto-generated)
 * @property {string} _rid - Resource ID
 * @property {string} _self - Self link URI
 * @property {string} _etag - ETag for optimistic concurrency checks
 * @property {string} _attachments - Attachments link
 * @property {number} _ts - Last-modified timestamp (Unix epoch seconds)
 */

/**
 * A document stored in Cosmos DB — the caller's shape plus Cosmos system properties.
 * @template T
 * @typedef {T & CosmosSystemProperties} CosmosDocument
 */

class Documents {
    /**
     * @param {{ client: import('@azure/cosmos').CosmosClient }} options
     */
    constructor(options) {
        this.client = options.client;
    }

    /**
     * Get collection by Id.
     * @param {string} collectionId
     * @returns {Promise<import('@azure/cosmos').Container>}
     */
    async #getCollection(collectionId) {
        return this.client.database(databaseId).container(collectionId);
    }

    /**
     * Create a document.
     * @template {import('@azure/cosmos').ItemDefinition} T
     * @param {string} collectionId
     * @param {T} document
     * @returns {Promise<CosmosDocument<T> | undefined>}
     */
    async createDocument(collectionId, document) {
        const container = await this.#getCollection(collectionId);
        const { resource: createdDocument } = await container.items.create(document);

        return /** @type {CosmosDocument<T> | undefined} */ (createdDocument);
    }

    /**
     * Delete document by Id.
     * @param {string} collectionId
     * @param {string} documentId
     * @param {string | number} partitionKey
     * @returns {Promise<void>}
     */
    async deleteDocumentById(collectionId, documentId, partitionKey) {
        const container = await this.#getCollection(collectionId);
        await container.item(documentId, partitionKey).delete();
    }

    /**
     * Get documents from a query.
     * @template T
     * @param {string} collectionId
     * @param {string | import('@azure/cosmos').SqlQuerySpec} query
     * @param {import('@azure/cosmos').FeedOptions} [options]
     * @returns {Promise<T[]>}
     */
    async getDocuments(collectionId, query, options) {
        const container = await this.#getCollection(collectionId);
        const { resources: items } = await container.items.query(query, options).fetchAll();

        return items;
    }

    /**
     * Insert if new or update an existing document.
     * @template {import('@azure/cosmos').ItemDefinition} T
     * @param {string} collectionId
     * @param {CosmosDocument<T>} document
     * @param {string | number} [partitionKey]
     * @returns {Promise<CosmosDocument<T> | undefined>}
     */
    async updateDocument(collectionId, document, partitionKey) {
        const container = await this.#getCollection(collectionId);
        const options = {
            accessCondition: {
                type: 'IfMatch',
                condition: document._etag,
            },
        };
        const { resource: updatedDocument } = await container
            .item(document.id, partitionKey)
            .replace(document, options);

        return /** @type {CosmosDocument<T> | undefined} */ (updatedDocument);
    }
}

export default Documents;
