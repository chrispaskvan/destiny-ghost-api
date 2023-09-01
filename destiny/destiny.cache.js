/**
 * Destiny Cache Class
 */
class DestinyCache {
    /**
     * Cache key for the latest Destiny Manifest cached.
     * @protected
     * @type {string}
     */
    _manifestKey = 'destiny-manifest';

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
    async getManifest() {
        // eslint-disable-next-line no-underscore-dangle
        const res = await this.client.get(this._manifestKey);

        return res ? JSON.parse(res) : undefined;
    }

    /**
     * Get the cached vendor.
     * @param vendorHash
     * @returns {Promise}
     */
    async getVendor(vendorHash) {
        const res = await this.client.get(vendorHash);

        return res ? JSON.parse(res) : undefined;
    }

    /**
     * Set the Destiny Manifest cache.
     * @param manifest
     * @returns {Promise}
     */
    async setManifest(manifest) {
        if (manifest && typeof manifest === 'object') {
            return await this.client.set(
                // eslint-disable-next-line no-underscore-dangle
                this._manifestKey,
                JSON.stringify(manifest),
                'EX',
                this.constructor.secondsUntilDailyReset(),
            );
        }

        throw new Error('Manifest object is required.');
    }

    /**
     * Set the vendor cache.
     * @param hash
     * @param vendor
     * @returns {Promise}
     */
    async setVendor(hash, vendor) {
        if (!hash || typeof hash !== 'number') {
            throw new Error('Vendor hash number is required.');
        }

        return await this.client.set(
            hash,
            JSON.stringify(vendor),
            'EX',
            this.constructor.secondsUntilDailyReset(),
        );
    }
}

export default DestinyCache;
