/**
 * A module for managing custom Bitlinks.
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
var Destiny = function (apiKey, cookies) {
    if (!apiKey || !_.isString(apiKey)) {
        throw new Error('The API key is missing.');
    }
    if (!cookies || !_.isArray(cookies)) {
        throw new Error('The Bungie cookies are absent.');
    }
    var self = this;
    /**
     * @member {string} apiKey - The Destiny API key.
     */
    self.apiKey = apiKey;
    /**
     * @member {Array.Object.{{name: string, value: string}}
     */
    self.cookies = cookies;
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
     * @function
     * @returns {string|*}
     * @private
     * @return {string}
     * @description Returns the cookie header string comprised of all Bungie cookies
     * required in certain web API requests.
     */
    var _getCookieHeader = function () {
        return _.reduce(self.cookies, function (memo, cookie) {
            return memo + ' ' + cookie.name + '=' + cookie.value + ';';
        }, ' ').trim();
    };
    /**
     * @function
     * @param cookieName {string}
     * @returns {string|*}
     * @private
     * @description Returns the value associated with the cookie identified by the
     * name provided.
     */
    var _getCookieValueByName = function (cookieName) {
        return _.find(self.cookies, function (cookie) {
            return cookie.name === cookieName;
        }).value;
    };
    /**
     * @function
     * @param characterId {string}
     * @param membershipId {string}
     * @returns {*|promise}
     */
    var getActivity = function (characterId, membershipId) {
        var opts = {
            headers: {
                cookie:  _getCookieHeader(),
                'x-api-key': self.apiKey,
                'x-csrf': _getCookieValueByName('bungled')
            },
            url: util.format('%s/Destiny/2/Account/%s/Character/%s/Activities/',
                servicePlatform, membershipId, characterId)
        };
        var deferred = Q.defer();
        request(opts, function (err, response, body) {
            if (!err && response.statusCode === 200) {
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
        return deferred.promise;
    };
    /**
     * @function
     * @param membershipId {string}
     * @param characterId {string}
     * @returns {*|promise}
     * @description Get the details for the member's character provided.
     */
    var getCharacter = function (membershipId, characterId) {
        var opts = {
            headers: {
                cookie:  _getCookieHeader(),
                'x-api-key': self.apiKey,
                'x-csrf': _getCookieValueByName('bungled')
            },
            url: util.format('%s/Destiny/2/Account/%s/Character/%s/Complete/',
                servicePlatform, membershipId, characterId)
        };
        var deferred = Q.defer();
        request(opts, function (err, response, body) {
            if (!err && response.statusCode === 200) {
                var responseBody = JSON.parse(body);
                if (responseBody.ErrorCode !== 1) {
                    deferred.reject(new DestinyError(responseBody.ErrorCode || -1,
                        responseBody.Message || '', responseBody.ErrorStatus || ''));
                } else {
                    var character = responseBody.Response.data;
                    deferred.resolve(character);
                }
            } else if (!err && response.statusCode === 99) {
                deferred.reject(new DestinyError(response.statusCode, response.Message));
            } else {
                deferred.reject(err);
            }
        });
        return deferred.promise;
    };
    /**
     * @function
     * @param membershipId {string}
     * @returns {*|promise}
     * @description Get character details.
     */
    var getCharacters = function (membershipId) {
        var deferred = Q.defer();
        destinyCache.get(membershipId, function (err, characters) {
            if (err) {
                deferred.reject(err);
            } else {
                if (characters) {
                    setTimeout(function () {
                        deferred.resolve(characters);
                    }, 10);
                } else {
                    var opts = {
                        headers: {
                            'x-api-key': self.apiKey
                        },
                        url: util.format('%s/Destiny/2/Account/%s/Summary/', servicePlatform,
                            membershipId)
                    };
                    request(opts, function (err, response, body) {
                        if (!err && response.statusCode === 200) {
                            var responseBody = JSON.parse(body);
                            if (responseBody.ErrorCode !== 1) {
                                deferred.reject(new DestinyError(responseBody.ErrorCode || -1,
                                    responseBody.Message || '', responseBody.ErrorStatus || ''));
                            } else {
                                characters = responseBody.Response.data.characters;
                                destinyCache.set(membershipId, characters);
                                deferred.resolve(characters);
                            }
                        } else {
                            deferred.reject(err);
                        }
                    });
                }
            }
        });
        return deferred.promise;
    };
    /**
     * @function
     * @param displayName {string}
     * @returns {*|promise}
     * @description Get the Bungie member number from the user's display name.
     */
    var getMembershipIdFromDisplayName = function (displayName) {
        var opts = {
            headers: {
                'x-api-key': self.apiKey
            },
            url: util.format('%s/Destiny/2/Stats/GetMembershipIdByDisplayName/%s/',
                servicePlatform, encodeURIComponent(displayName))
        };
        var deferred = Q.defer();
        request(opts, function (err, response, body) {
            if (!err && response.statusCode === 200) {
                deferred.resolve(JSON.parse(body).Response);
            } else {
                deferred.reject(err);
            }
        });
        return deferred.promise;
    };
    /**
     * @function
     * @returns {*|promise}
     * @description Get the current user based on the Bungie cookies.
     */
    var getCurrentUser = function () {
        var deferred = Q.defer();
        var opts = {
            headers: {
                cookie:  _getCookieHeader(),
                'x-api-key': self.apiKey,
                'x-csrf': _getCookieValueByName('bungled')
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
        return deferred.promise;
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
    var getFieldTestWeapons = function (characterId) {
        var deferred = Q.defer();
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
                            cookie: _getCookieHeader(),
                            'x-api-key': self.apiKey,
                            'x-csrf': _getCookieValueByName('bungled')
                        },
                        url: util.format('%s/Destiny/2/MyAccount/Character/%s/Vendor/%s/',
                            servicePlatform, characterId, gunSmithHash)
                    };
                    request(opts, function (error, res, body) {
                        if (!(!error && res.statusCode === 200)) {
                            deferred.reject(error);
                        } else {
                            var responseBody = JSON.parse(body);
                            if (responseBody.Reponse !== undefined ||
                                    responseBody.ErrorCode !== 1) {
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
        return deferred.promise;
    };
    /**
     * @function
     * @param characterId {string}
     * @param membershipId {string}
     * @returns {*|promise}
     */
    var getInventory = function (characterId, membershipId) {
        var opts = {
            headers: {
                cookie:  _getCookieHeader(),
                'x-api-key': self.apiKey,
                'x-csrf': _getCookieValueByName('bungled')
            },
            url: util.format('%s/Destiny/2/Account/%s/Character/%s/Inventory/',
                servicePlatform, membershipId, characterId)
        };
        var deferred = Q.defer();
        request(opts, function (err, response, body) {
            if (!err && response.statusCode === 200) {
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
        return deferred.promise;
    };
    /**
     * @function
     * @param itemHash {string}
     * @returns {*|promise}
     */
    var getItem = function (itemHash) {
        var opts = {
            headers: {
                cookie:  _getCookieHeader(),
                'x-api-key': self.apiKey,
                'x-csrf': _getCookieValueByName('bungled')
            },
            url: util.format('%s/Destiny/Manifest/2/%s/', servicePlatform, itemHash)
        };
        var deferred = Q.defer();
        request(opts, function (err, response, body) {
            if (!err && response.statusCode === 200) {
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
        return deferred.promise;
    };
    /**
     * @function
     * @returns {*|promise}
     * @description Get the latest Destiny manifest definition.
     */
    var getManifest = function () {
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
                    request(opts, function (err, response, body) {
                        if (!err && response.statusCode === 200) {
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
        return deferred.promise;
    };
    /**
     * @function
     * @param characterId {string}
     * @param membershipId {string}
     * @returns {*|promise}
     */
    var getProgression = function (characterId, membershipId) {
        var opts = {
            headers: {
                cookie:  _getCookieHeader(),
                'x-api-key': self.apiKey,
                'x-csrf': _getCookieValueByName('bungled')
            },
            url: util.format('%s/Destiny/2/Account/%s/Character/%s/Progression/',
                servicePlatform, membershipId, characterId)
        };
        var deferred = Q.defer();
        request(opts, function (err, response, body) {
            if (!err && response.statusCode === 200) {
                var character = JSON.parse(body).Response;
                deferred.resolve(character);
            } else {
                deferred.reject(err);
            }
        });
        return deferred.promise;
    };
    /**
     * @function
     * @param characterId {string}
     * @returns {*|promise}
     */
    var getVendorSummaries = function (characterId) {
        var deferred = Q.defer();
        var opts = {
            headers: {
                cookie:  _getCookieHeader(),
                'x-api-key': self.apiKey,
                'x-csrf': _getCookieValueByName('bungled')
            },
            url: util.format('%s/Destiny/2/MyAccount/Character/%s/Vendors/Summaries/',
                servicePlatform, characterId)
        };
        request(opts, function (err, response, body) {
            if (!err && response.statusCode === 200) {
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
        return deferred.promise;
    };
    /**
     * @function
     * @param characterId {string}
     * @param membershipId {string}
     * @returns {*|promise}
     */
    var getWeapons = function (characterId, membershipId) {
        var opts = {
            headers: {
                cookie:  _getCookieHeader(),
                'x-api-key': self.apiKey,
                'x-csrf': _getCookieValueByName('bungled')
            },
            url: util.format('%s/Destiny/stats/uniqueweapons/2/%s/%s/',
                servicePlatform, membershipId, characterId)
        };
        var deferred = Q.defer();
        request(opts, function (err, response, body) {
            if (!(!err && response.statusCode === 200)) {
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
        return deferred.promise;
    };
    /**
     * @function
     * @returns {*|promise}
     * @description Get the exotic gear and waepons available for sale from XUr.
     */
    var getXur = function () {
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
                    request(opts, function (err, response, body) {
                        if (!err && response.statusCode === 200) {
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
        return deferred.promise;
    };
    /**
     * @function
     * @param cookies {Array}
     * @description Refresh the Bungie cookies.
     */
    var setAuthenticationCookies = function (cookies) {
        self.cookies = cookies;
    };
    return {
        getActivity: getActivity,
        getCharacter: getCharacter,
        getCharacters: getCharacters,
        getCurrentUser: getCurrentUser,
        getFieldTestWeapons: getFieldTestWeapons,
        getInventory: getInventory,
        getItem: getItem,
        getManifest: getManifest,
        getMembershipIdFromDisplayName: getMembershipIdFromDisplayName,
        getProgression: getProgression,
        getVendorSummaries: getVendorSummaries,
        getWeapons: getWeapons,
        getXur: getXur,
        setAuthenticationCookies: setAuthenticationCookies
    };
};

module.exports = Destiny;
