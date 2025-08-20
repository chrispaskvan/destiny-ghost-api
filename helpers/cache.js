import { createClient } from 'redis';
import configuration from './config.js';
import log from './log.js';

/**
 * Cache Store
 * @description Client includes built-in reconnect strategy. {@link https://github.com/redis/node-redis#reconnection}
 */
const { redis = {} } = configuration;
const { host, port, ...options } = redis;
const url = `rediss://${host}:${port}`;
const redisConfiguration = {
    socket: {
        connectTimeout: 60000,
        lazyConnect: false,
        reconnectStrategy: retries => {
            // Continuously try to reconnect with exponential backoff
            // Cap the delay at 30 seconds to avoid extremely long waits
            const delay = Math.min(retries * 100, 30000);

            log.info(`Redis reconnection attempt ${retries}`);

            return delay;
        },
        servername: host,
        tls: true,
    },
    url,
    ...options,
};
const client = createClient(redisConfiguration);

client.on('connect', () => log.info('Cache client is connected.'));
client.on('reconnecting', () => log.info('Cache client is reconnecting...'));
client.on('error', err => log.error({ err }, 'Connection to the cache failed.'));

await client.connect();

export default client;
