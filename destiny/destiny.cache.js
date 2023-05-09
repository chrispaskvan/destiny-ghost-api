/**
 * Destiny Cache Class
 */
class DestinyCache {
    /**
     * Cache key for the latest Destiny Manifest cached.
     * @type {string}
     */
    #manifestKey = 'destiny-manifest';

    constructor(options = {}) {
        this.client = options.client;
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
            this.client.get(
                this.#manifestKey,
                (err, res) => (err ? reject(err) : resolve(res ? JSON.parse(res) : undefined)),
            );
        });
    }

    /**
     * Get the cached vendor.
     * @param vendorHash
     * @returns {Promise}
     */
    getVendor(vendorHash) {
        return new Promise((resolve, reject) => {
            this.client.get(
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
                this.client.set(
                    this.#manifestKey,
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
            this.client.set(
                hash,
                JSON.stringify(vendor),
                'EX',
                this.constructor.secondsUntilDailyReset(),
                (err, res) => (err ? reject(err) : resolve(res)),
            );
        });
    }
}

export default DestinyCache;
