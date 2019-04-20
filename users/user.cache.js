const redis = require('redis');
const redisConfig = require('../settings/redis.json');

/**
 *  User Cache Class
 */
class UserCache {
    /**
     * @constructor
     */
    constructor() {
        this.client = redis.createClient(redisConfig.port, redisConfig.host, {
            auth_pass: redisConfig.key, // jscs:ignore requireCamelCaseOrUpperCaseIdentifiers
            ttl: 3300,
        });
    }

    /**
     * @param teeth
     * @returns {string}
     */
    static getCacheKey(...teeth) {
        return teeth.join('|');
    }

    /**
     * Delete cache by key.
     * @param key
     * @returns {Promise}
     * @private
     */
    deleteCache(key) {
        return new Promise((resolve, reject) => {
            this.client.del(key, (err, res) => {
                if (err) {
                    reject(err);
                } else {
                    resolve(res);
                }
            });
        });
    }

    /**
     * Delete cached user.
     * @param teeth
     * @returns {Promise}
     */
    deleteUser({ displayName, membershipType, phoneNumber }) {
        let promise1;
        let promise2;

        if (phoneNumber) {
            promise1 = this.deleteCache(this.constructor.getCacheKey(phoneNumber));
        } else {
            promise1 = new Promise.resolve(); // eslint-disable-line new-cap
        }

        if (displayName && membershipType) {
            promise2 = this.deleteCache(this.constructor.getCacheKey(displayName, membershipType));
        } else {
            promise2 = new Promise.resolve(); // eslint-disable-line new-cap
        }
        return Promise.all([promise1, promise2]);
    }

    // ToDo
    destroy() {
        this.client.quit();
    }

    /**
     * Get cached item by key.
     * @param key
     * @returns {Promise}
     * @private
     */
    getCache(key) {
        return new Promise((resolve, reject) => {
            this.client.get(key, (err, res) => {
                if (err) {
                    return reject(err);
                }

                return resolve(res ? JSON.parse(res) : undefined);
            });
        });
    }

    /**
     * Get cached user.
     * @param teeth
     * @returns {Promise}
     */
    async getUser(...teeth) {
        const key = this.constructor.getCacheKey(...teeth);

        const user = await this.getCache(key);
        if (user) {
            const { displayName, membershipId, membershipType } = user;

            if (!membershipId && displayName && membershipType) {
                return this.getUser(displayName, membershipType);
            }

            return user;
        }

        return undefined;
    }

    /**
     * Set cached user.
     * @param user
     * @returns {*}
     */
    setUser(user) {
        const { displayName, membershipType, phoneNumber } = user;
        const key = this.constructor.getCacheKey(displayName, membershipType);

        if (!displayName) {
            return Promise.reject(new Error('displayName not found'));
        }
        if (!membershipType) {
            return Promise.reject(new Error('membershipType not found'));
        }

        const promise1 = new Promise((resolve, reject) => {
            this.client.set(key, JSON.stringify(user), (err, res) => {
                if (err) {
                    reject(err);
                } else {
                    resolve(res);
                }
            });
        });

        let promise2;

        if (phoneNumber) {
            promise2 = new Promise((resolve, reject) => {
                this.client.set(phoneNumber,
                    JSON.stringify({ displayName, membershipType }), (err, res) => {
                        if (err) {
                            reject(err);
                        } else {
                            resolve(res);
                        }
                    });
            });
        } else {
            promise2 = Promise.resolve();
        }

        return Promise.all([promise1, promise2]);
    }
}

module.exports = UserCache;
