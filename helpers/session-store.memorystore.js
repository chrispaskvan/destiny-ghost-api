const session = require('express-session');
const MemorySession = require('memorystore');

const sessionConfig = require(`../settings/session.json`); // eslint-disable-line import/no-dynamic-require

/**
 * Cache Store Client
 */
const MemoryStore = MemorySession(session);
const store = new MemoryStore({
    maxAge: sessionConfig.cookie.maxAge,
});

module.exports.store = store;
