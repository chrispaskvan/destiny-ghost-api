import Redis from 'ioredis';
import configuration from './config';
import log from './log';

const { redis } = configuration;
/**
 * Cache Store
 * Jobs Client for BullMQ
 * @description Redis client used for BullMQ job queueing. Includes built-in reconnect strategy. {@link https://github.com/redis/ioredis#auto-reconnect}
 */
const redisConfiguration = {
    maxRetriesPerRequest: 0,
    ...redis,
};
const client = new Redis(redisConfiguration);

client.on('connect', () => log.info('Jobs client is connected.'));
client.on('reconnecting', () => log.info('Jobs client is reconnecting...'));
client.on('error', err => log.error({ err }, 'Connection to the jobs failed.'));

export default client;