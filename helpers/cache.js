// eslint-disable-next-line import/no-extraneous-dependencies
import Redis from 'ioredis';
import configuration from './config';
import log from './log';

const { redis } = configuration;
/**
 * Cache Store
 * @description Client includes built-in reconnect strategy. {@link https://github.com/redis/ioredis#auto-reconnect}
 */
const redisConfiguration = {
    maxRetriesPerRequest: 0,
    ...redis,
};
const client = new Redis(redisConfiguration);

client.on('connect', () => log.info('Redis Client is connected.'));
client.on('error', err => log.error({ err }, 'Connection to the Redis Server failed.'));

export default client;
