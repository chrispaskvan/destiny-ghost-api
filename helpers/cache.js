import { createClient } from 'redis';
import configuration from './config.js';
import log from './log.js';

const { redis } = configuration;
/**
 * Cache Store
 * @description Client includes built-in reconnect strategy. {@link https://github.com/redis/ioredis#auto-reconnect}
 */
const { host, port, ...options } = redis;
const url = `rediss://${host}:${port}`;
const redisConfiguration = {
    maxRetriesPerRequest: 0,
    socket: {
        tls: true,
        servername: host,
    },
    url,
    ...options,
};
const client = createClient(redisConfiguration);

client.on('connect', () => log.info('Redis Client is connected.'));
client.on('error', err => log.error({ err }, 'Connection to the Redis Server failed.'));

await client.connect();

export default client;
