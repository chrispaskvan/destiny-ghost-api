import Redis from 'ioredis';
import configuration from './config.js';
import log from './log.js';

const { redis } = configuration;
/**
 * Cache Store
 * Jobs Client for BullMQ
 * @description Redis client used for BullMQ job queueing. Includes built-in reconnect strategy. {@link https://github.com/redis/ioredis#auto-reconnect}
 */
const redisConfiguration = {
    maxRetriesPerRequest: 0,
    ...redis,
    // Pin RESP2: the production Redis deployment does not support RESP3, which ioredis defaults to as of v6.
    // Placed after the spread so settings files can't silently override this.
    protocol: 2,
};
const client = new Redis(redisConfiguration);

client.on('connect', () => log.info('Jobs client is connected.'));
client.on('reconnecting', () => log.info('Jobs client is reconnecting...'));
client.on('error', err => log.error({ err }, 'Connection to the jobs failed.'));

export default client;
