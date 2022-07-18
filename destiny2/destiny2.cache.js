import cache from '../helpers/cache';
import DestinyCache from '../destiny/destiny.cache';

/**
 * Destiny Cache Class
 */
class Destiny2Cache extends DestinyCache {
    /**
     * Cache key for the latest Destiny Manifest cached.
     * @type {string}
     */
    #manifestKey = 'destiny2-manifest';

    /**
     * Get the cached list of characters for the user.
     * @param {*} membershipId
     */
    // eslint-disable-next-line class-methods-use-this
    getCharacters(membershipId) {
        return new Promise((resolve, reject) => {
            cache.get(membershipId, (err, res) => {
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
            cache.get(
                this.#manifestKey,
                (err, res) => (err ? reject(err) : resolve(res ? JSON.parse(res) : undefined)),
            );
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
            cache.set(membershipId, JSON.stringify(characters), (err, success) => {
                if (err) {
                    reject(err);
                } else {
                    resolve(success);
                }
            });
        });
    }
}

export default Destiny2Cache;
