const NodeCache = require('node-cache');
const redis = require('redis');
const { host, key, port } = require('../settings/redis.json');

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
        this.cache = new NodeCache({ stdTTL: 3600, checkperiod: 0, useClones: true });
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
            this.cache.get(this.constructor.manifestKey, (err, manifest) => {
                if (err) {
                    reject(err);
                } else {
                    resolve(manifest);
                }
            });
        });
    }

    /**
     * Get the cached vendor.
     * @param vendorHash
     * @returns {Promise}
     */
    getVendor(vendorHash) {
        return new Promise((resolve, reject) => {
            this.cache.get(vendorHash,
                (err, res) => (err ? reject(err) : resolve(res ? JSON.parse(res) : undefined)));
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
                this.cache.set(this.constructor.manifestKey, manifest, (err, success) => {
                    if (err) {
                        reject(err);
                    } else {
                        resolve(success);
                    }
                });
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
            this.cache.set(vendorHash,
                JSON.stringify(vendor), (err, res) => (err ? reject(err) : resolve(res)));
        });
    }
}

module.exports = DestinyCache;
