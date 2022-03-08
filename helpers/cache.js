// eslint-disable-next-line import/no-extraneous-dependencies
const Redis = require('ioredis');
const { redis: redisConfig } = require('./config');

/**
 * Cache Store
 */
const configuration = {
    host: redisConfig.host,
    port: redisConfig.port,
    password: redisConfig.key,
    tls: {
        servername: redisConfig.host,
    },
};
const client = new Redis(configuration);

module.exports = client;
