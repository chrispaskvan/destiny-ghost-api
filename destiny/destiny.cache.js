const redis = require('redis'),
    { host, key, port } = require('../settings/redis.json');

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
     * @constructor
     */
    constructor() {
        this.client = redis.createClient(port, host, {
            auth_pass: key, // jscs:ignore requireCamelCaseOrUpperCaseIdentifiers
            ttl: 3300
        });
    }

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

    /**
     * Get the cached vendor.
     * @param vendorHash
     * @returns {Promise}
     */
    getVendor(vendorHash) {
        return new Promise((resolve, reject) => {
            this.client.get(vendorHash,
                (err, res) => err ? reject(err) : resolve(res ? JSON.parse(res) : undefined));
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
                this.client.set(this.constructor.manifestKey, JSON.stringify(manifest),
                    (err, res) => err ? reject(err) : resolve(res));
            });
        }

        return Promise.reject(new Error('vendorHash number is required.'));
    }

    /**
     * Set the vendor cache.
     * @param vendor
     * @returns {Promise}
     */
    setVendor(vendor) {
        const { vendorHash } = vendor;

        if (typeof vendorHash !== 'number') {
            return Promise.reject(new Error('vendorHash number is required.'));
        }

        return new Promise((resolve, reject) => {
            this.client.set(vendorHash, JSON.stringify(vendor), (err, res) => err ? reject(err) : resolve(res));
        });
    }
}

module.exports = DestinyCache;
