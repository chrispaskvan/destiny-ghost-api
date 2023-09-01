import cache from '../helpers/cache';
import DestinyCache from '../destiny/destiny.cache';

/**
 * Destiny Cache Class
 */
class Destiny2Cache extends DestinyCache {
    /**
     * Cache key for the latest Destiny Manifest cached.
     * @protected
     * @type {string}
     */
    _manifestKey = 'destiny2-manifest';

    /**
     * Get the cached list of characters for the user.
     * @param {*} membershipId
     */
    // eslint-disable-next-line class-methods-use-this
    async getCharacters(membershipId) {
        const res = await cache.get(membershipId);

        return res ? JSON.parse(res) : undefined;
    }

    /**
     * Get the cached Destiny Manifest.
     * @returns {Promise}
     */
    async getManifest() {
        // eslint-disable-next-line no-underscore-dangle
        const res = await cache.get(this._manifestKey);

        return res ? JSON.parse(res) : undefined;
    }

    /**
     * Set the list of characters for the user.
     * @param {*} membershipId
     * @param {*} characters
     */
    // eslint-disable-next-line class-methods-use-this
    async setCharacters(membershipId, characters) {
        if (!(membershipId && typeof membershipId === 'string')) {
            throw new Error('membershipId is a required string.');
        }

        if (!(characters && characters.length)) {
            throw new Error('characters is a required and must be a nonempty array.');
        }

        return await cache.set(membershipId, JSON.stringify(characters));
    }
}

export default Destiny2Cache;
