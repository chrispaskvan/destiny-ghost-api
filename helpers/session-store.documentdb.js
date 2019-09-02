const DocumentDBSession = require('documentdb-session');
const session = require('express-session');
const cosmosConfig = require('../settings/documents.json');

const sessionConfig = require(`../settings/session.json`); // eslint-disable-line import/no-dynamic-require

/**
 * Cache Store Client
 */
const DocumentDBStore = DocumentDBSession(session);
const store = new DocumentDBStore({
    database: cosmosConfig.databaseId,
    host: cosmosConfig.host,
    key: cosmosConfig.authenticationKey,
    ttl: sessionConfig.cookie.maxAge,
});

module.exports.client = store.client;
module.exports.store = store;
