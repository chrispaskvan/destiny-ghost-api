/**
 *  User Cache Class
 */
class UserCache {
    constructor(options = {}) {
        this.client = options.client;
    }

    /**
     * @param teeth
     * @returns {string}
     */
    static #getCacheKey(...teeth) {
        return teeth.join('|');
    }

    /**
     * Delete cache by key.
     * @param key
     * @returns {Promise}
     * @private
     */
    #deleteCache(key) {
        return new Promise((resolve, reject) => {
            this.client.del(
                key,
                (err, res) => (err ? reject(err) : resolve(res)),
            );
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
            promise1 = this.#deleteCache(UserCache.#getCacheKey(phoneNumber));
        } else {
            promise1 = Promise.resolve();
        }

        if (displayName && membershipType) {
            // eslint-disable-next-line max-len
            promise2 = this.#deleteCache(UserCache.#getCacheKey(displayName, membershipType));
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
        const key = UserCache.#getCacheKey(...teeth);

        const user = await this.getCache(key);
        if (user) {
            const { displayName, membershipId, membershipType } = user;

            if (!membershipId && displayName && membershipType) {
                return await this.getUser(displayName, membershipType);
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
        const {
            displayName,
            emailAddress,
            membershipType,
            phoneNumber,
        } = user;

        if (!displayName) {
            return Promise.reject(new Error('displayName not found'));
        }
        if (!membershipType) {
            return Promise.reject(new Error('membershipType not found'));
        }

        const key = UserCache.#getCacheKey(displayName, membershipType);
        const promise1 = new Promise((resolve, reject) => {
            this.client.set(
                key,
                JSON.stringify(user),
                'EX',
                60 * 60,
                (err, res) => (err ? reject(err) : resolve(res)),
            );
        });

        let promise2;

        if (phoneNumber) {
            promise2 = new Promise((resolve, reject) => {
                this.client.set(
                    phoneNumber,
                    JSON.stringify({ displayName, membershipType }),

                    'EX',

                    60 * 60,
                    (err, res) => (err ? reject(err) : resolve(res)),
                );
            });
        } else {
            promise2 = Promise.resolve();
        }

        let promise3;

        if (emailAddress) {
            promise3 = new Promise((resolve, reject) => {
                this.client.set(
                    emailAddress,
                    JSON.stringify({ displayName, membershipType }),

                    'EX',

                    60 * 60,
                    (err, res) => (err ? reject(err) : resolve(res)),
                );
            });
        } else {
            promise3 = Promise.resolve();
        }

        return Promise.all([promise1, promise2, promise3]);
    }
}

export default UserCache;
