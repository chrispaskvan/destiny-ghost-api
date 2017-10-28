'use strict';
const redis = require('redis'),
    redisConfig = require('../settings/redis.json');

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
            ttl: 3300
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
            this.client.del(key, function (err, res) {
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
        let promise1, promise2;

        if (phoneNumber) {
            promise1 = this._deleteCache(this.constructor.getCacheKey(phoneNumber));
        } else {
            promise1 = new Promise.resolve();
        }

        if (displayName && membershipType) {
            promise2 = this._deleteCache(this.constructor.getCacheKey(displayName, membershipType));
        } else {
            promise2 = new Promise.resolve();
        }
        return Promise.all([promise1, promise2]);
    }

    /**
     * Get cached item by key.
     * @param key
     * @returns {Promise}
     * @private
     */
    _getCache(key) {
        return new Promise((resolve, reject) => {
            this.client.get(key, function (err, res) {
                if (err) {
                    return reject(err);
                }

                resolve(res ? JSON.parse(res) : undefined);
            });
        });
    }

    /**
     * Get cached user.
     * @param teeth
     * @returns {Promise}
     */
    getUser(...teeth) {
        const key = this.constructor.getCacheKey(...teeth);

        return this._getCache(key)
            .then(user => {
                if (user) {
                    const {displayName, membershipId, membershipType} = user;

                    if (!membershipId && displayName && membershipType) {
                        return this.getUser(displayName, membershipType);
                    }

                    return user;
                }

                return undefined;
            });
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
            this.client.set(key, JSON.stringify(user), function (err, res) {
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
                this.client.set(phoneNumber, JSON.stringify({ displayName, membershipType }), function (err, res) {
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
