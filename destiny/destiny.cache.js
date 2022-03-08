const client = require('../helpers/cache');

/**
 * Cache key for the latest Destiny Manifest cached.
 * @type {string}
 */
const manifestKey = 'destiny-manifest';

/**
 * Destiny Cache Class
 */
class DestinyCache {
    /**
     * Get manifest key.
     * @returns {string}
     */
    static get manifestKey() {
        return manifestKey;
    }

    /**
     * Get the seconds left before the next daily reset.
     * @returns {number}
     */
    static secondsUntilDailyReset() {
        const now = new Date();
        const then = new Date(now);

        then.setUTCHours(17);
        then.setUTCMinutes(0);
        if (then < now) {
            then.setDate(then.getDate() + 1);
        }

        return (then - now) / 1000;
    }

    /**
     * Get the cached Destiny Manifest.
     * @returns {Promise}
     */
    getManifest() {
        return new Promise((resolve, reject) => {
            client.get(
                this.constructor.manifestKey,
                (err, res) => (err ? reject(err) : resolve(res ? JSON.parse(res) : undefined)),
            );
        });
    }

    /**
     * Get the cached vendor.
     * @param vendorHash
     * @returns {Promise}
     */
    // eslint-disable-next-line class-methods-use-this
    getVendor(vendorHash) {
        return new Promise((resolve, reject) => {
            client.get(
                vendorHash,
                (err, res) => (err ? reject(err) : resolve(res ? JSON.parse(res) : undefined)),
            );
        });
    }

    /**
     * Set the Destiny Manifest cache.
     * @param manifest
     * @returns {Promise}
     */
    setManifest(manifest) {
        if (manifest && typeof manifest === 'object') {
            return new Promise((resolve, reject) => {
                client.set(
                    this.constructor.manifestKey,
                    JSON.stringify(manifest),
                    'EX',
                    this.constructor.secondsUntilDailyReset(),
                    (err, success) => {
                        if (err) {
                            reject(err);
                        } else {
                            resolve(success);
                        }
                    },
                );
            });
        }

        return Promise.reject(new Error('Manifest object is required.'));
    }

    /**
     * Set the vendor cache.
     * @param hash
     * @param vendor
     * @returns {Promise}
     */
    setVendor(hash, vendor) {
        if (!hash || typeof hash !== 'number') {
            return Promise.reject(new Error('Vendor hash number is required.'));
        }

        return new Promise((resolve, reject) => {
            client.set(
                hash,
                JSON.stringify(vendor),
                'EX',
                this.constructor.secondsUntilDailyReset(),
                (err, res) => (err ? reject(err) : resolve(res)),
            );
        });
    }
}

module.exports = DestinyCache;
