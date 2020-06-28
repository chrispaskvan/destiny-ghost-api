const client = require('../helpers/cache');
const DestinyCache = require('../destiny/destiny.cache');

/**
 * Cache key for the latest Destiny Manifest cached.
 * @type {string}
 */
const manifestKey = 'destiny2-manifest';

/**
 * Destiny Cache Class
 */
class Destiny2Cache extends DestinyCache {
    /**
     * Get manifest key.
     * @returns {string}
     */
    static get manifestKey() {
        return manifestKey;
    }

    /**
     * Get the cached list of characters for the user.
     * @param {*} membershipId
     */
    // eslint-disable-next-line class-methods-use-this
    getCharacters(membershipId) {
        return new Promise((resolve, reject) => {
            client.get(membershipId, (err, res) => {
                if (err) {
                    reject(err);
                } else {
                    resolve(res ? JSON.parse(res) : undefined);
                }
            });
        });
    }

    /**
     * Get the cached Destiny Manifest.
     * @returns {Promise}
     */
    getManifest() {
        return new Promise((resolve, reject) => {
            client.get(this.constructor.manifestKey,
                (err, res) => (err ? reject(err) : resolve(res ? JSON.parse(res) : undefined)));
        });
    }

    /**
     * Set the list of characters for the user.
     * @param {*} membershipId
     * @param {*} characters
     */
    // eslint-disable-next-line class-methods-use-this
    setCharacters(membershipId, characters) {
        if (!(membershipId && typeof membershipId === 'string')) {
            return Promise.reject(new Error('membershipId is a required string.'));
        }

        if (!(characters && characters.length)) {
            return Promise.reject(new Error('characters is a required and must be a nonempty array.'));
        }

        return new Promise((resolve, reject) => {
            client.set(membershipId, JSON.stringify(characters), (err, success) => {
                if (err) {
                    reject(err);
                } else {
                    resolve(success);
                }
            });
        });
    }
}

module.exports = Destiny2Cache;
