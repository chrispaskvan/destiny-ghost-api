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
	 * Get the cached Destiny Manifest.
	 * @returns {Promise}
	 */
	getManifest() {
		return new Promise((resolve, reject) => {
			this.client.get(this.constructor.manifestKey,
				(err, res) => err ? reject(err) : resolve(res ? JSON.parse(res) : undefined));
		});
	}
}

module.exports = Destiny2Cache;
