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
}

exports = module.exports = Destiny2Cache;
