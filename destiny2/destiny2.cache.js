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
    async getCharacters(membershipId) { // eslint-disable-line class-methods-use-this
        const res = await cache.get(membershipId);

        return res ? JSON.parse(res) : undefined;
    }

    /**
     * Set the list of characters for the user.
     * @param {*} membershipId
     * @param {*} characters
     */
    async setCharacters(membershipId, characters) { // eslint-disable-line class-methods-use-this
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
