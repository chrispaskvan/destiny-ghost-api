import RedisSession from 'connect-redis';
import session from 'express-session';
import client from './cache';

/**
 * Cache Store
 */
const RedisStore = RedisSession(session);
const store = new RedisStore({
    client,
});

export default store;
