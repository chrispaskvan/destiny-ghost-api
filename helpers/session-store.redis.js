const RedisSession = require('connect-redis');
const redis = require('redis');
const session = require('express-session');
const { redis: redisConfig } = require('../helpers/config');

/**
 * Cache Store and Client
 */
const RedisStore = RedisSession(session);

const client = redis.createClient(redisConfig.port, redisConfig.host, {
    auth_pass: redisConfig.key, // jscs:ignore requireCamelCaseOrUpperCaseIdentifiers
    tls: {
        servername: redisConfig.host,
    },
});
const store = new RedisStore({
    client,
});

module.exports.client = client;
module.exports.store = store;
