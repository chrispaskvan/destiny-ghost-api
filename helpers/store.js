const RedisSession = require('connect-redis');
const session = require('express-session');
const client = require('./cache');

/**
 * Cache Store
 */
const RedisStore = RedisSession(session);
const store = new RedisStore({
    client,
});

module.exports = store;
