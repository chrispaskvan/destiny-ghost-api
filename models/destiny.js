/**
 * A module for interacting with the Bungie Destiny web API.
 *
 * @module Destiny
 * @summary Helper functions for accessing the Destiny web API.
 * @author Chris Paskvan
 * @description Utility functions for requests against the Bungie web API for
 * managing users and destiny characters, etc. For more information check out
 * the wiki at {@link http://bungienetplatform.wikia.com/wiki/Endpoints} or
 * the Bungie web API platform help page {@link https://www.bungie.net/platform/destiny/help/}.
 * @requires _
 * @requires NodeCache
 * @requires Q
 * @requires request
 * @requires util
 */
'use strict';
var _ = require('underscore'),
    NodeCache = require('node-cache'),
    Q = require('q'),
    request = require('request'),
    util = require('util');
/**
 * @param apiKey {string}
 * @param cookies
 * @throws Invalid argument(s) provided.
 * @constructor
 */
var Destiny = function (apiKey) {
    if (!apiKey || !_.isString(apiKey)) {
        throw new Error('The API key is missing.');
    }
    var self = this;
    /**
     * @member {string} apiKey - The Destiny API key.
     */
    self.apiKey = apiKey;
    /**
     * @constant
     * @type {string}
     * @description Base URL for all of the Bungie API services.
     */
    var servicePlatform = 'https://www.bungie.net/platform';
    /**
     * Create a new error from an error response to a Destiny web API request.
     * @class
     * @param code {string}
     * @param message {string}
     * @param status {string}
     * @constructor
     */
    var DestinyError = function (code, message, status) {
        _.extend(this, {
            code: code,
            message: message,
            name: 'DestinyError',
            stack: (new Error()).stack,
            status: status
        });
    };
    DestinyError.prototype = Object.create(Error.prototype);
    DestinyError.prototype.constructor = DestinyError;
    /**
     * Local cache.
     * @type {*|exports|module.exports}
     */
    var destinyCache = new NodeCache({ stdTTL: 0, checkperiod: 0, useClones: true });
    /**
     * @description Returns the cookie header string comprised of all Bungie cookies
     * required in certain web API requests.
     * @param cookies
     * @returns {string|*}
     * @private
     */
    var _getCookieHeader = function (cookies) {
        return _.reduce(cookies, function (memo, cookie) {
            return memo + ' ' + cookie.name + '=' + cookie.value + ';';
        }, ' ').trim();
    };
    /**
     * @function
     * @param cookies
     * @param cookieName {string}
     * @returns {string|*}
     * @private
     * @description Returns the value associated with the cookie identified by the
     * name provided.
     */
    var _getCookieValueByName = function (cookies, cookieName) {
        return _.find(cookies, function (cookie) {
            return cookie.name === cookieName;
        }).value;
    };
    /**
     * @function
     * @param characterId {string}
     * @param membershipId {string}
     * @returns {*|promise}
     */
    var getActivity = function (characterId, membershipId, cookies, callback) {
        var deferred = Q.defer();
        if (!cookies || !_.isArray(cookies)) {
            deferred.reject(new Error('The Bungie cookies are missing.'));
            return deferred.promise.nodeify(callback);
        }
        var opts = {
            headers: {
                cookie: _getCookieHeader(cookies),
                'x-api-key': self.apiKey,
                'x-csrf': _getCookieValueByName(cookies, 'bungled')
            },
            url: util.format('%s/Destiny/2/Account/%s/Character/%s/Activities/',
                servicePlatform, membershipId, characterId)
        };
        request(opts, function (err, res, body) {
            if (!err && res.statusCode === 200) {
                var responseBody = JSON.parse(body);
                if (responseBody.ErrorCode !== 1) {
                    deferred.reject(new DestinyError(responseBody.ErrorCode || -1,
                        responseBody.Message || '', responseBody.ErrorStatus || ''));
                } else {
                    var character = JSON.parse(body).Response;
                    deferred.resolve(character);
                }
            } else {
                deferred.reject(err);
            }
        });
        return deferred.promise.nodeify(callback);
    };
    /**
     * @function
     * @param membershipId {string}
     * @param characterId {string}
     * @returns {*|promise}
     * @description Get the details for the member's character provided.
     */
    var getCharacter = function (membershipId, characterId, cookies, callback) {
        var deferred = Q.defer();
        if (!cookies || !_.isArray(cookies)) {
            deferred.reject(new Error('The Bungie cookies are missing.'));
            return deferred.promise.nodeify(callback);
        }
        var opts = {
            headers: {
                cookie: _getCookieHeader(cookies),
                'x-api-key': self.apiKey,
                'x-csrf': _getCookieValueByName(cookies, 'bungled')
            },
            url: util.format('%s/Destiny/2/Account/%s/Character/%s/Complete/',
                servicePlatform, membershipId, characterId)
        };
        request(opts, function (err, res, body) {
            if (!err && res.statusCode === 200) {
                var responseBody = JSON.parse(body);
                if (responseBody.ErrorCode !== 1) {
                    deferred.reject(new DestinyError(responseBody.ErrorCode || -1,
                        responseBody.Message || '', responseBody.ErrorStatus || ''));
                } else {
                    var character = responseBody.Response.data;
                    deferred.resolve(character);
                }
            } else if (!err && res.statusCode === 99) {
                deferred.reject(new DestinyError(res.statusCode, res.Message));
            } else {
                deferred.reject(err);
            }
        });
        return deferred.promise.nodeify(callback);
    };
    /**
     * @function
     * @param membershipId {string}
     * @returns {*|promise}
     * @description Get character details.
     */
    var getCharacters = function (membershipId, callback) {
        var deferred = Q.defer();
        var opts = {
            headers: {
                'x-api-key': self.apiKey
            },
            url: util.format('%s/Destiny/2/Account/%s/Summary/', servicePlatform,
                membershipId)
        };
        request(opts, function (err, res, body) {
            if (!err && res.statusCode === 200) {
                var responseBody = JSON.parse(body);
                if (responseBody.ErrorCode !== 1) {
                    deferred.reject(new DestinyError(responseBody.ErrorCode || -1,
                        responseBody.Message || '', responseBody.ErrorStatus || ''));
                } else {
                    deferred.resolve(responseBody.Response.data.characters);
                }
            } else {
                deferred.reject(err);
            }
        });
        return deferred.promise.nodeify(callback);
    };
    /**
     * @function
     * @param displayName {string}
     * @returns {*|promise}
     * @description Get the Bungie member number from the user's display name.
     */
    var getMembershipIdFromDisplayName = function (displayName, callback) {
        var deferred = Q.defer();
        var opts = {
            headers: {
                'x-api-key': self.apiKey
            },
            url: util.format('%s/Destiny/2/Stats/GetMembershipIdByDisplayName/%s/',
                servicePlatform, encodeURIComponent(displayName))
        };
        request(opts, function (err, res, body) {
            if (!err && res.statusCode === 200) {
                deferred.resolve(JSON.parse(body).Response);
            } else {
                deferred.reject(err);
            }
        });
        return deferred.promise.nodeify(callback);
    };
    /**
     * @function
     * @returns {*|promise}
     * @description Get the current user based on the Bungie cookies.
     */
    var getCurrentUser = function (cookies, callback) {
        var deferred = Q.defer();
        if (!cookies || !_.isArray(cookies)) {
            deferred.reject(new Error('The Bungie cookies are missing.'));
            return deferred.promise.nodeify(callback);
        }
        var opts = {
            headers: {
                cookie: _getCookieHeader(cookies),
                'x-api-key': self.apiKey,
                'x-csrf': _getCookieValueByName(cookies, 'bungled')
            },
            url: util.format('%s/User/GetBungieNetUser/', servicePlatform)
        };
        request(opts, function (err, res, body) {
            if (!err && res.statusCode === 200) {
                var responseBody = JSON.parse(body);
                if (responseBody.Reponse !== undefined || responseBody.ErrorCode !== 1) {
                    deferred.reject(new DestinyError(responseBody.ErrorCode,
                        responseBody.Message, responseBody.Status));
                } else {
                    var user = responseBody.Response;
                    getMembershipIdFromDisplayName(user.psnId)
                        .then(function (membershipId) {
                            if (user) {
                                deferred.resolve({
                                    displayName: user.psnid,
                                    email: user.email,
                                    membershipId: membershipId
                                });
                            } else {
                                deferred.resolve([]);
                            }
                        });
                }
            } else {
                deferred.reject(err);
            }
        });
        return deferred.promise.nodeify(callback);
    };
    /**
     * @constant
     * @type {string}
     * @description Banshee-44's Vendor Number
     */
    var gunSmithHash = '570929315';
    /**
     * @function
     * @param characterId {string}
     * @returns {*|promise}
     * @description Return the current field test weapons available from the gunsmith.
     */
    var getFieldTestWeapons = function (characterId, cookies, callback) {
        var deferred = Q.defer();
        if (!cookies || !_.isArray(cookies)) {
            deferred.reject(new Error('The Bungie cookies are missing.'));
            return deferred.promise.nodeify(callback);
        }
        destinyCache.get('getFieldTestWeapons', function (err, saleItems) {
            if (err) {
                deferred.reject(err);
            } else {
                if (saleItems) {
                    setTimeout(function () {
                        deferred.resolve(saleItems);
                    }, 10);
                } else {
                    var opts = {
                        headers: {
                            cookie: _getCookieHeader(cookies),
                            'x-api-key': self.apiKey,
                            'x-csrf': _getCookieValueByName(cookies, 'bungled')
                        },
                        url: util.format('%s/Destiny/2/MyAccount/Character/%s/Vendor/%s/',
                            servicePlatform, characterId, gunSmithHash)
                    };
                    request(opts, function (error, res, body) {
                        if (!(!error && res.statusCode === 200)) {
                            deferred.reject(error);
                        } else {
                            var responseBody = JSON.parse(body);
                            if (responseBody.ErrorCode !== 1) {
                                deferred.reject(new DestinyError(responseBody.ErrorCode,
                                    responseBody.Message, responseBody.Status));
                            } else {
                                var data = responseBody.Response.data;
                                if (data) {
                                    var saleItemCategories = data.saleItemCategories;
                                    var fieldTestWeapons = _.find(saleItemCategories, function (saleItemCategory) {
                                        return saleItemCategory.categoryTitle === 'Field Test Weapons';
                                    });
                                    destinyCache.set('getFieldTestWeapons', fieldTestWeapons.saleItems);
                                    deferred.resolve(fieldTestWeapons.saleItems);
                                } else {
                                    deferred.resolve([]);
                                }
                            }
                        }
                    });
                }
            }
        });
        return deferred.promise.nodeify(callback);
    };
    /**
     * @function
     * @param characterId {string}
     * @returns {*|promise}
     * @description Return the current field test weapons available from the gunsmith.
     */
    var getFoundryOrders = function (characterId, cookies, callback) {
        var deferred = Q.defer();
        if (!cookies || !_.isArray(cookies)) {
            deferred.reject(new Error('The Bungie cookies are missing.'));
            return deferred.promise.nodeify(callback);
        }
        destinyCache.get('getFoundryOrders', function (err, saleItems) {
            if (err) {
                deferred.reject(err);
            } else {
                if (saleItems) {
                    setTimeout(function () {
                        deferred.resolve(saleItems);
                    }, 10);
                } else {
                    var opts = {
                        headers: {
                            cookie: _getCookieHeader(cookies),
                            'x-api-key': self.apiKey,
                            'x-csrf': _getCookieValueByName(cookies, 'bungled')
                        },
                        url: util.format('%s/Destiny/2/MyAccount/Character/%s/Vendor/%s/',
                            servicePlatform, characterId, gunSmithHash)
                    };
                    request(opts, function (error, res, body) {
                        if (!(!error && res.statusCode === 200)) {
                            deferred.reject(error);
                        } else {
                            var responseBody = JSON.parse(body);
                            if (responseBody.ErrorCode !== 1) {
                                deferred.reject(new DestinyError(responseBody.ErrorCode,
                                    responseBody.Message, responseBody.Status));
                            } else {
                                var data = responseBody.Response.data;
                                if (data) {
                                    var saleItemCategories = data.saleItemCategories;
                                    var foundryOrders = _.find(saleItemCategories, function (saleItemCategory) {
                                        return saleItemCategory.categoryTitle === 'Foundry Orders';
                                    });
                                    destinyCache.set('getFoundryOrders', foundryOrders.saleItems);
                                    deferred.resolve(foundryOrders.saleItems);
                                } else {
                                    deferred.resolve([]);
                                }
                            }
                        }
                    });
                }
            }
        });
        return deferred.promise.nodeify(callback);
    };
    /**
     * @function
     * @param characterId {string}
     * @param membershipId {string}
     * @returns {*|promise}
     */
    var getInventory = function (characterId, membershipId, cookies, callback) {
        var deferred = Q.defer();
        if (!cookies || !_.isArray(cookies)) {
            deferred.reject(new Error('The Bungie cookies are missing.'));
            return deferred.promise.nodeify(callback);
        }
        var opts = {
            headers: {
                cookie: _getCookieHeader(cookies),
                'x-api-key': self.apiKey,
                'x-csrf': _getCookieValueByName(cookies, 'bungled')
            },
            url: util.format('%s/Destiny/2/Account/%s/Character/%s/Inventory/',
                servicePlatform, membershipId, characterId)
        };
        request(opts, function (err, res, body) {
            if (!err && res.statusCode === 200) {
                var responseBody = JSON.parse(body);
                if (responseBody.ErrorCode !== 1) {
                    deferred.reject(new DestinyError(responseBody.ErrorCode || -1,
                        responseBody.Message || '', responseBody.ErrorStatus || ''));
                } else {
                    var character = responseBody.Response.data;
                    deferred.resolve(character);
                }
            } else {
                deferred.reject(err);
            }
        });
        return deferred.promise.nodeify(callback);
    };
    /**
     * @constant
     * @type {string}
     * @description Iron Banner's Vendor Number
     */
    var lordSaladinHash = '242140165';
    /**
     * @function
     * @param characterId {string}
     * @returns {*|promise}
     * @description Return the current field test weapons available from the gunsmith.
     */
    var getIronBannerEventRewards = function (characterId, cookies, callback) {
        var deferred = Q.defer();
        if (!cookies || !_.isArray(cookies)) {
            deferred.reject(new Error('The Bungie cookies are missing.'));
            return deferred.promise.nodeify(callback);
        }
        destinyCache.get('getIronBannerEventRewards', function (err, saleItems) {
            if (err) {
                deferred.reject(err);
            } else {
                if (saleItems) {
                    setTimeout(function () {
                        deferred.resolve(saleItems);
                    }, 10);
                } else {
                    var opts = {
                        headers: {
                            cookie: _getCookieHeader(cookies),
                            'x-api-key': self.apiKey,
                            'x-csrf': _getCookieValueByName(cookies, 'bungled')
                        },
                        url: util.format('%s/Destiny/2/MyAccount/Character/%s/Vendor/%s/',
                            servicePlatform, characterId, lordSaladinHash)
                    };
                    request(opts, function (error, res, body) {
                        if (!err && res.statusCode === 200) {
                            var responseBody = JSON.parse(body);
                            if (responseBody.ErrorCode === 1627) {
                                deferred.resolve([]);
                            } else if (responseBody.ErrorCode !== 1) {
                                deferred.reject(new DestinyError(responseBody.ErrorCode ||
                                    -1, responseBody.Message || '',
                                    responseBody.ErrorStatus || ''));
                            } else {
                                var data = responseBody.Response.data;
                                if (data) {
                                    var saleItemCategories = data.saleItemCategories;
                                    var eventRewards = _.find(saleItemCategories, function (saleItemCategory) {
                                        return saleItemCategory.categoryTitle === 'Event Rewards';
                                    });
                                    destinyCache.set('getIronBannerEventRewards', eventRewards.saleItems);
                                    deferred.resolve(eventRewards.saleItems);
                                } else {
                                    deferred.resolve([]);
                                }
                            }
                        }
                    });
                }
            }
        });
        return deferred.promise.nodeify(callback);
    };
    /**
     * @function
     * @param itemHash {string}
     * @returns {*|promise}
     */
    var getItem = function (itemHash, callback) {
        var deferred = Q.defer();
        var opts = {
            headers: {
                cookie: _getCookieHeader(cookies),
                'x-api-key': self.apiKey,
                'x-csrf': _getCookieValueByName(cookies, 'bungled')
            },
            url: util.format('%s/Destiny/Manifest/2/%s/', servicePlatform, itemHash)
        };
        request(opts, function (err, res, body) {
            if (!err && res.statusCode === 200) {
                var responseBody = JSON.parse(body);
                if (responseBody.ErrorCode !== 1) {
                    deferred.reject(new DestinyError(responseBody.ErrorCode || -1,
                        responseBody.Message || '', responseBody.ErrorStatus || ''));
                } else {
                    deferred.resolve(responseBody);
                }
            } else {
                deferred.reject(err);
            }
        });
        return deferred.promise.nodeify(callback);
    };
    /**
     * @function
     * @returns {*|promise}
     * @description Get the latest Destiny manifest definition.
     */
    var getManifest = function (callback) {
        var deferred = Q.defer();
        destinyCache.get('getManifest', function (err, manifest) {
            if (err) {
                deferred.reject(err);
            } else {
                if (manifest) {
                    setTimeout(function () {
                        deferred.resolve(manifest);
                    }, 50);
                } else {
                    var opts = {
                        headers: {
                            'x-api-key': self.apiKey
                        },
                        url: util.format('%s/Destiny/Manifest', servicePlatform)
                    };
                    request(opts, function (err, res, body) {
                        if (!err && res.statusCode === 200) {
                            manifest = JSON.parse(body).Response;
                            destinyCache.set('getManifest', manifest);
                            deferred.resolve(manifest);
                        } else {
                            deferred.reject(err);
                        }
                    });
                }
            }
        });
        return deferred.promise.nodeify(callback);
    };
    /**
     * @function
     * @param characterId {string}
     * @param membershipId {string}
     * @returns {*|promise}
     */
    var getProgression = function (characterId, membershipId, cookies, callback) {
        var deferred = Q.defer();
        if (!cookies || !_.isArray(cookies)) {
            deferred.reject(new Error('The Bungie cookies are missing.'));
            return deferred.promise.nodeify(callback);
        }
        var opts = {
            headers: {
                cookie: _getCookieHeader(cookies),
                'x-api-key': self.apiKey,
                'x-csrf': _getCookieValueByName(cookies, 'bungled')
            },
            url: util.format('%s/Destiny/2/Account/%s/Character/%s/Progression/',
                servicePlatform, membershipId, characterId)
        };
        request(opts, function (err, res, body) {
            if (!err && res.statusCode === 200) {
                var character = JSON.parse(body).Response;
                deferred.resolve(character);
            } else {
                deferred.reject(err);
            }
        });
        return deferred.promise.nodeify(callback);
    };
    /**
     * @function
     * @param characterId {string}
     * @returns {*|promise}
     */
    var getVendorSummaries = function (characterId, cookies, callback) {
        var deferred = Q.defer();
        if (!cookies || !_.isArray(cookies)) {
            deferred.reject(new Error('The Bungie cookies are missing.'));
            return deferred.promise.nodeify(callback);
        }
        var opts = {
            headers: {
                cookie: _getCookieHeader(cookies),
                'x-api-key': self.apiKey,
                'x-csrf': _getCookieValueByName(cookies, 'bungled')
            },
            url: util.format('%s/Destiny/2/MyAccount/Character/%s/Vendors/Summaries/',
                servicePlatform, characterId)
        };
        request(opts, function (err, res, body) {
            if (!err && res.statusCode === 200) {
                var responseBody = JSON.parse(body);
                if (responseBody.ErrorCode !== 1) {
                    deferred.reject(new DestinyError(responseBody.ErrorCode ||
                        -1, responseBody.Message || '',
                        responseBody.ErrorStatus || ''));
                } else {
                    var data = responseBody.Response.data;
                    if (data) {
                        deferred.resolve(data.vendors);
                    } else {
                        deferred.resolve([]);
                    }
                }
            } else {
                deferred.reject(err);
            }
        });
        return deferred.promise.nodeify(callback);
    };
    /**
     * @function
     * @param characterId {string}
     * @param membershipId {string}
     * @returns {*|promise}
     */
    var getWeapons = function (characterId, membershipId, cookies, callback) {
        var deferred = Q.defer();
        if (!cookies || !_.isArray(cookies)) {
            deferred.reject(new Error('The Bungie cookies are missing.'));
            return deferred.promise.nodeify(callback);
        }
        var opts = {
            headers: {
                cookie: _getCookieHeader(cookies),
                'x-api-key': self.apiKey,
                'x-csrf': _getCookieValueByName(cookies, 'bungled')
            },
            url: util.format('%s/Destiny/stats/uniqueweapons/2/%s/%s/',
                servicePlatform, membershipId, characterId)
        };
        request(opts, function (err, res, body) {
            if (!(!err && res.statusCode === 200)) {
                deferred.reject(err);
            } else {
                var weapons = body.Response.data.weapons;
                deferred.resolve(weapons.sort(function (a, b) {
                    if (a.values.uniqueWeaponKillsPrecisionKills.basic.value <
                            b.values.uniqueWeaponKillsPrecisionKills.basic.value) {
                        return -1;
                    }
                    if (a.values.uniqueWeaponKillsPrecisionKills.basic.value >
                            b.values.uniqueWeaponKillsPrecisionKills.basic.value) {
                        return 1;
                    }
                    return 0;
                }));
            }
        });
        return deferred.promise.nodeify(callback);
    };
    /**
     * @function
     * @returns {*|promise}
     * @description Get the exotic gear and waepons available for sale from XUr.
     */
    var getXur = function (callback) {
        var deferred = Q.defer();
        destinyCache.get('getXur', function (err, items) {
            if (err) {
                deferred.reject(err);
            } else {
                if (items) {
                    deferred.resolve(items);
                } else {
                    var opts = {
                        headers: {
                            'x-api-key': self.apiKey
                        },
                        url: util.format('%s/Destiny/Advisors/Xur/', servicePlatform)
                    };
                    request(opts, function (err, res, body) {
                        if (!err && res.statusCode === 200) {
                            var responseBody = JSON.parse(body);
                            if (responseBody.ErrorCode === 1627) {
                                deferred.resolve([]);
                            } else if (responseBody.ErrorCode !== 1) {
                                deferred.reject(new DestinyError(responseBody.ErrorCode ||
                                    -1, responseBody.Message || '',
                                    responseBody.ErrorStatus || ''));
                            } else {
                                var data = responseBody.Response.data;
                                if (data) {
                                    var saleItemCategories = data.saleItemCategories;
                                    var exotics = _.find(saleItemCategories,
                                        function (saleItemCategory) {
                                            return saleItemCategory.categoryTitle ===
                                                'Exotic Gear';
                                        });
                                    destinyCache.set('getXur', exotics.saleItems);
                                    deferred.resolve(exotics.saleItems);
                                } else {
                                    deferred.resolve([]);
                                }
                            }
                        } else {
                            deferred.reject(err);
                        }
                    });
                }
            }
        });
        return deferred.promise.nodeify(callback);
    };
    return {
        getActivity: getActivity,
        getCharacter: getCharacter,
        getCharacters: getCharacters,
        getCurrentUser: getCurrentUser,
        getFieldTestWeapons: getFieldTestWeapons,
        getFoundryOrders: getFoundryOrders,
        getInventory: getInventory,
        getIronBannerEventRewards: getIronBannerEventRewards,
        getItem: getItem,
        getManifest: getManifest,
        getMembershipIdFromDisplayName: getMembershipIdFromDisplayName,
        getProgression: getProgression,
        getVendorSummaries: getVendorSummaries,
        getWeapons: getWeapons,
        getXur: getXur
    };
};

module.exports = Destiny;
