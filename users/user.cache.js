const client = require('../helpers/cache');

/**
 *  User Cache Class
 */
class UserCache {
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
    // eslint-disable-next-line class-methods-use-this
    deleteCache(key) {
        return new Promise((resolve, reject) => {
            client.del(key, (err, res) => {
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
            promise1 = Promise.resolve();
        }

        if (displayName && membershipType) {
            promise2 = this.deleteCache(this.constructor.getCacheKey(displayName, membershipType));
        } else {
            promise2 = Promise.resolve();
        }

        return Promise.all([promise1, promise2]);
    }

    /**
     * Get cached item by key.
     * @param key
     * @returns {Promise}
     * @private
     */
    // eslint-disable-next-line class-methods-use-this
    getCache(key) {
        return new Promise((resolve, reject) => {
            client.get(key, (err, res) => {
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
            client.set(key, JSON.stringify(user), 'EX', 60 * 60, (err, res) => {
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
                client.set(phoneNumber,
                    JSON.stringify({ displayName, membershipType }), 'EX', 60 * 60, (err, res) => {
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
