import { RedisStore } from 'connect-redis';
import client from './cache.js';

/**
 * Cache Store
 */
const store = new RedisStore({
    client,
});

export default store;
