import RedisErrors from 'redis-errors';
import log from '../helpers/log.js';

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
    async getManifest(manifestKey = this._manifestKey) {
        try {
            const res = await this.client.get(manifestKey);
            const { lastModified, manifest } = res ? JSON.parse(res) : {};

            if (manifest) {
                const ttl = await this.client.ttl(manifestKey);

                return {
                    data: {
                        manifest,
                    },
                    meta: {
                        lastModified,
                        maxAge: ttl,
                    },
                };
            }
        } catch (err) {
            if (!(err instanceof RedisErrors.RedisError)) throw err;

            log.error(err);
        }

        return undefined;
    }

    /**
     * Get the cached vendor.
     * @param vendorHash
     * @returns {Promise}
     */
    async getVendor(vendorHash) {
        try {
            const res = await this.client.get(vendorHash.toString());

            return res ? JSON.parse(res) : undefined;
        } catch (err) {
            if (!(err instanceof RedisErrors.RedisError)) throw err;

            log.error(err);
        }

        return undefined;
    }

    /**
     * Set the Destiny Manifest cache.
     * @param manifest
     * @returns {Promise}
     */
    async setManifest({
        lastModified,
        manifest,
        maxAge,
    }) {
        if (manifest && typeof manifest === 'object') {
            try {
                return await this.client.setEx(
                    this._manifestKey,
                    maxAge,
                    JSON.stringify({ lastModified, manifest }),
                );
            } catch (err) {
                if (!(err instanceof RedisErrors.RedisError)) throw err;

                log.error(err);

                return 'Error';
            }
        }

        throw new Error('Manifest object is required');
    }

    /**
     * Set the vendor cache.
     * @param hash
     * @param vendor
     * @returns {Promise}
     */
    async setVendor(hash, vendor) {
        if (!hash || typeof hash !== 'number') {
            throw new Error('Vendor hash number is required');
        }

        try {
            return await this.client.setEx(
                hash.toString(),
                this.constructor.secondsUntilDailyReset(),
                JSON.stringify(vendor),
            );
        } catch (err) {
            if (!(err instanceof RedisErrors.RedisError)) throw err;

            log.error(err);

            return 'Error';
        }
    }
}

export default DestinyCache;
