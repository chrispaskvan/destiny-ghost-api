'use strict';
var Q = require('q'),
    redis = require('redis'),
    redisConfig = require('../settings/redis.json');

function DestinyCache() {
    this.client = redis.createClient(redisConfig.port, redisConfig.host, {
        auth_pass: redisConfig.key, // jscs:ignore requireCamelCaseOrUpperCaseIdentifiers
        ttl: 3300
    });
}

DestinyCache.prototype.getVendor = function(vendorHash) {
    const deferred = Q.defer();

    this.client.get(vendorHash, function (err, res) {
        if (err) {
            return deferred.reject(err);
        }

        deferred.resolve(res ? JSON.parse(res) : undefined);
    });

    return deferred.promise;
};

DestinyCache.prototype.setVendor = function(vendor) {
    const deferred = Q.defer();
    const { vendorHash } = vendor;

    if (typeof vendorHash !== 'number') {
        deferred.reject(Error('vendorHash number is required.'));

        return deferred.promise;
    }

    this.client.set(vendorHash, JSON.stringify(vendor), function (err, res) {
        if (err) {
            deferred.reject(err);
        } else {
            deferred.resolve(res);
        }
    });

    return deferred.promise;
};

exports = module.exports = DestinyCache;
