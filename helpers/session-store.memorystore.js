const session = require('express-session');
const MemorySession = require('memorystore');

const { session: sessionConfig } = require('../helpers/config');

/**
 * Cache Store Client
 */
const MemoryStore = MemorySession(session);
const store = new MemoryStore({
    maxAge: sessionConfig.cookie.maxAge,
});

module.exports.store = store;
