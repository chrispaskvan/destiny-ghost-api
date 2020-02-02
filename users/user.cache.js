const redis = require('redis');
const { redis: redisConfig } = require('../helpers/config');

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
            tls: {
                servername: redisConfig.host,
            },
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
    _deleteCache(key) {
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
            promise1 = this._deleteCache(this.constructor.getCacheKey(phoneNumber)); // eslint-disable-line no-underscore-dangle, max-len
        } else {
            promise1 = Promise.resolve(); // eslint-disable-line new-cap
        }

        if (displayName && membershipType) {
            promise2 = this._deleteCache(this.constructor.getCacheKey(displayName, membershipType)); // eslint-disable-line no-underscore-dangle, max-len
        } else {
            promise2 = Promise.resolve(); // eslint-disable-line new-cap
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
    _getCache(key) {
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

        const user = await this._getCache(key); // eslint-disable-line no-underscore-dangle
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
    setUser(user = {}) {
        const { displayName, membershipType, phoneNumber } = user;

        if (!displayName) {
            return Promise.reject(new Error('displayName not found'));
        }
        if (!membershipType) {
            return Promise.reject(new Error('membershipType not found'));
        }

        const key = this.constructor.getCacheKey(displayName, membershipType);
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
