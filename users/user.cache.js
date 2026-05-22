// @ts-check

/**
 * A minimal pointer stored under phone-number and email-address cache keys.
 * The full user object is stored under the displayName+membershipType key.
 * @typedef {Object} CachedUserRef
 * @property {string} displayName
 * @property {number} membershipType
 */

/**
 * The Redis client methods used by UserCache.
 * Structural interface so the implementation detail (node-redis vs ioredis) stays decoupled.
 * @typedef {Object} RedisClient
 * @property {(key: string) => Promise<number>} del
 * @property {(key: string) => Promise<string | null>} get
 * @property {(key: string, seconds: number, value: string) => Promise<string>} setEx
 */

/**
 *  User Cache Class
 */
class UserCache {
    /**
     * @param {{ client: RedisClient }} options
     */
    constructor(options) {
        this.client = options.client;
    }

    /**
     * @param {...(string | number)} teeth
     * @returns {string}
     */
    static #getCacheKey(...teeth) {
        return teeth.join('|');
    }

    /**
     * Delete cache by key.
     * @param {string} key
     * @returns {Promise<number>}
     */
    async #deleteCache(key) {
        return await this.client.del(key);
    }

    /**
     * Delete all cache entries associated with a user.
     * @param {{ displayName?: string, membershipType?: number, phoneNumber?: string }} user
     * @returns {Promise<[number | void, number | void]>}
     */
    deleteUser({ displayName, membershipType, phoneNumber }) {
        let promise1;
        let promise2;

        if (phoneNumber) {
            promise1 = this.#deleteCache(UserCache.#getCacheKey(phoneNumber));
        } else {
            promise1 = Promise.resolve();
        }

        if (displayName && membershipType) {
            promise2 = this.#deleteCache(UserCache.#getCacheKey(displayName, membershipType));
        } else {
            promise2 = Promise.resolve();
        }

        return Promise.all([promise1, promise2]);
    }

    /**
     * Get cached item by key.
     * @param {string} key
     * @returns {Promise<Record<string, unknown> | undefined>}
     */
    async getCache(key) {
        const res = await this.client.get(key);

        return res ? JSON.parse(res) : undefined;
    }

    /**
     * Get cached user by one or more cache-key segments (displayName+membershipType,
     * phoneNumber, or emailAddress). Follows pointer keys back to the full user record.
     * @param {...(string | number)} teeth
     * @returns {Promise<Record<string, unknown> | undefined>}
     */
    async getUser(...teeth) {
        const key = UserCache.#getCacheKey(...teeth);

        const user = await this.getCache(key);
        if (user) {
            const { displayName, membershipId, membershipType } = user;

            if (
                !membershipId &&
                typeof displayName === 'string' &&
                typeof membershipType === 'number'
            ) {
                return await this.getUser(displayName, membershipType);
            }

            return user;
        }

        return undefined;
    }

    /**
     * Cache a user under all applicable keys (displayName+membershipType,
     * phoneNumber, and emailAddress). TTL is 1 hour.
     * @param {{ displayName?: string, emailAddress?: string, membershipType?: number, phoneNumber?: string }} user
     * @returns {Promise<void>}
     */
    async setUser(user = {}) {
        const { displayName, emailAddress, membershipType, phoneNumber } = user;

        if (!displayName) {
            return Promise.reject(new Error('displayName not found'));
        }
        if (!membershipType) {
            return Promise.reject(new Error('membershipType not found'));
        }

        const key = UserCache.#getCacheKey(displayName, membershipType);
        const promise1 = this.client.setEx(key, 60 * 60, JSON.stringify(user));

        let promise2;

        if (phoneNumber) {
            promise2 = this.client.setEx(
                phoneNumber,
                60 * 60,
                JSON.stringify({ displayName, membershipType }),
            );
        } else {
            promise2 = Promise.resolve();
        }

        let promise3;

        if (emailAddress) {
            promise3 = this.client.setEx(
                emailAddress,
                60 * 60,
                JSON.stringify({ displayName, membershipType }),
            );
        } else {
            promise3 = Promise.resolve();
        }

        await Promise.all([promise1, promise2, promise3]);
    }
}

export default UserCache;
