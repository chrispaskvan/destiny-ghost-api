'use strict';
var Q = require('q'),
    redis = require('redis'),
    redisConfig = require('../settings/redis.json');

const manifestKey = 'destiny-manifest'

class DestinyCache {
    /**
     * @constructor
     */
    constructor() {
        this.client = redis.createClient(redisConfig.port, redisConfig.host, {
            auth_pass: redisConfig.key, // jscs:ignore requireCamelCaseOrUpperCaseIdentifiers
            ttl: 3300
        });
    }
    getManifest() {
        return new Promise((resolve, reject) => {
            this.client.get(manifestKey, (err, res) => err ? reject(err) : resolve(res ? JSON.parse(res) : undefined));
        });
    }
    getVendor(vendorHash) {
        return new Promise((resolve, reject) => {
            this.client.get(vendorHash, (err, res) => err ? reject(err) : resolve(res ? JSON.parse(res) : undefined));
        });
    }
    setManifest(manifest) {
        if (manifest !== null && typeof manifest === 'object') {
            Promise.reject(new Error('vendorHash number is required.'));
        }

        return new Promise((resolve, reject) => {
            this.client.set(manifestKey, JSON.stringify(manifest), (err, res) => err ? reject(err) : resolve(res));
        });
    }
    setVendor(vendor) {
        const { vendorHash } = vendor;

        if (typeof vendorHash !== 'number') {
            Promise.reject(new Error('vendorHash number is required.'));
        }

        return new Promise((resolve, reject) => {
            this.client.set(vendorHash, JSON.stringify(vendor), (err, res) => err ? reject(err) : resolve(res));
        });
    }
}

exports = module.exports = DestinyCache;
