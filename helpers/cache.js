// eslint-disable-next-line import/no-extraneous-dependencies
const redis = process.env.NODE_ENV === 'test' ? require('redis-mock') : require('redis');
const { redis: redisConfig } = require('./config');

/**
 * Cache Store
 */
const client = redis.createClient(redisConfig.port, redisConfig.host, {
    auth_pass: redisConfig.key, // jscs:ignore requireCamelCaseOrUpperCaseIdentifiers
    tls: {
        servername: redisConfig.host,
    },
});

module.exports = client;
