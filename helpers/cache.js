// eslint-disable-next-line import/no-extraneous-dependencies
import Redis from 'ioredis';
import configuration from './config';

const { redis } = configuration;
/**
 * Cache Store
 */
const redisConfiguration = {
    host: redis.host,
    port: redis.port,
    password: redis.key,
    tls: {
        servername: redis.host,
    },
};
const client = new Redis(redisConfiguration);

export default client;
