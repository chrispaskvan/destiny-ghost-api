'use strict';
var Q = require('q'),
    redis = require('redis'),
    redisConfig = require('../settings/redis.json');

function getCacheKey(displayName, membershipType) {
    return displayName + '|' + membershipType;
}

function UserCache() {
    this.client = redis.createClient(redisConfig.port, redisConfig.host, {
        auth_pass: redisConfig.key, // jscs:ignore requireCamelCaseOrUpperCaseIdentifiers
        ttl: 3300
    });
}

UserCache.prototype.getUser = function(displayName, membershipType, callback) {
    var deferred = Q.defer();
    var key = getCacheKey(displayName, membershipType);

    this.client.get(key, function (err, res) {
        if (err) {
            return deferred.reject(err);
        }

        deferred.resolve(res ? JSON.parse(res) : undefined);
    });

    return deferred.promise.nodeify(callback);
};

UserCache.prototype.setUser = function(user, callback) {
    var deferred = Q.defer();
    var key = getCacheKey(user.displayName, user.membershipType);

    this.client.set(key, JSON.stringify(user), function (err, res) {
        if (err) {
            deferred.reject(err);
        } else {
            deferred.resolve(res);
        }
    });

    return deferred.promise.nodeify(callback);
};

exports = module.exports = UserCache;
