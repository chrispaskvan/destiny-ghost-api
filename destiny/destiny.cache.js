// @ts-check
import log from '../helpers/log.js';

/**
 * The Redis client methods used by DestinyCache.
 * Structural interface so the implementation detail (node-redis vs ioredis) stays decoupled.
 * @typedef {Object} RedisClient
 * @property {(key: string) => Promise<string | null>} get
 * @property {(key: string, seconds: number, value: string) => Promise<string>} setEx
 * @property {(key: string) => Promise<number>} ttl - Seconds remaining before the key expires
 */

/**
 * The Bungie Destiny Manifest definition. Bungie returns many more fields than
 * this; only the ones this application reads are modeled.
 * @typedef {Object} DestinyManifest
 * @property {string} version
 * @property {Record<string, string>} [mobileWorldContentPaths] - Locale-keyed paths to the world content database
 * @property {Record<string, string>} [jsonWorldContentPaths] - Locale-keyed paths to the JSON world content
 */

/**
 * A manifest paired with its freshness metadata, as returned by both the cache
 * and a live Bungie fetch.
 * @typedef {Object} ManifestResult
 * @property {{ manifest: DestinyManifest }} data
 * @property {{ lastModified?: string, maxAge: number, wasCached?: boolean }} meta
 */

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

    /**
     * @param {{ client: RedisClient }} options
     */
    constructor(options) {
        this.client = options.client;
    }

    /**
     * Get the seconds left before the next daily reset.
     * @returns {number}
     */
    static secondsUntilDailyReset() {
        const now = Temporal.Now.zonedDateTimeISO('UTC');
        let reset = now.withPlainTime({ hour: 17, minute: 0, second: 0 });

        if (Temporal.ZonedDateTime.compare(reset, now) <= 0) {
            reset = reset.add({ days: 1 });
        }

        return Math.ceil(now.until(reset, { largestUnit: 'seconds' }).total('seconds'));
    }

    /**
     * Get the cached Destiny Manifest.
     * @param {string} [manifestKey] - Defaults to this instance's manifest key.
     * @returns {Promise<ManifestResult | undefined>}
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
            log.error(err);
        }

        return undefined;
    }

    /**
     * Get the cached vendor's item hashes.
     * @param {number} vendorHash
     * @returns {Promise<number[] | undefined>}
     */
    async getVendor(vendorHash) {
        try {
            const res = await this.client.get(vendorHash.toString());

            return res ? JSON.parse(res) : undefined;
        } catch (err) {
            log.error(err);
        }

        return undefined;
    }

    /**
     * Set the Destiny Manifest cache.
     * @param {{ lastModified?: string, manifest: DestinyManifest, maxAge: number }} entry
     * @returns {Promise<string>} The client's reply, or 'Error' if the write failed.
     */
    async setManifest({ lastModified, manifest, maxAge }) {
        if (manifest && typeof manifest === 'object') {
            try {
                return await this.client.setEx(
                    this._manifestKey,
                    maxAge,
                    JSON.stringify({ lastModified, manifest }),
                );
            } catch (err) {
                log.error(err);

                return 'Error';
            }
        }

        throw new Error('Manifest object is required');
    }

    /**
     * Set the vendor cache.
     * @param {number} hash
     * @param {number[]} vendor - The vendor's item hashes.
     * @returns {Promise<string>} The client's reply, or 'Error' if the write failed.
     */
    async setVendor(hash, vendor) {
        if (!hash || typeof hash !== 'number') {
            throw new Error('Vendor hash number is required');
        }

        try {
            return await this.client.setEx(
                hash.toString(),
                // Cast because `this.constructor` is typed as the base `Function`;
                // going through it (rather than naming the class) keeps the static
                // overridable by subclasses.
                /** @type {typeof DestinyCache} */ (this.constructor).secondsUntilDailyReset(),
                JSON.stringify(vendor),
            );
        } catch (err) {
            log.error(err);

            return 'Error';
        }
    }
}

export default DestinyCache;
