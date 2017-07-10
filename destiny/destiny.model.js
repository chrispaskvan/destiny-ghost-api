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
var _ = require('underscore'),
    bungie = require('../settings/bungie.json'),
    NodeCache = require('node-cache'),
    Q = require('q'),
    request = require('request'),
    util = require('util');
/**
 * @throws API key not found.
 * @constructor
 */
function Destiny() {
    'use strict';
    /**
     * @member {string} apiKey - The Destiny API key.
     */
    this.apiKey = bungie.apiKey;
    if (!this.apiKey || !_.isString(this.apiKey)) {
        throw new Error('The API key is missing.');
    }
    /**
     * @member {string} apiKey - The Destiny API key.
     */
    this.authorizationUrl = bungie.authorizationUrl;
    if (!this.authorizationUrl || !_.isString(this.authorizationUrl)) {
        throw new Error('The authorization URL is missing.');
    }
}

/**
 * Available Membership Types
 * @type {{TigerXbox: number, TigerPsn: number}}
 * @description Membership types as defined by the Bungie Destiny API
 * outlined at {@link http://bungienetplatform.wikia.com/wiki/BungieMembershipType}.
 */
var membershipTypes = {
    TigerXbox: 1,
    TigerPsn: 2
};
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
 *
 * @param code
 * @private
 */
Destiny.prototype.getAccessTokenFromCode = function (code, callback) {
    var deferred = Q.defer();
    var opts = {
        body: JSON.stringify({
            code: code
        }),
        headers: {
            'x-api-key': this.apiKey
        },
        url: util.format('%s/App/GetAccessTokensFromCode/', servicePlatform)
    };
    request.post(opts, function (err, res, body) {
        if (!err && res.statusCode === 200) {
            var responseBody = JSON.parse(body);
            if (responseBody.ErrorCode !== 1) {
                deferred.reject(new DestinyError(responseBody.ErrorCode || -1,
                    responseBody.Message || '', responseBody.ErrorStatus || ''));
            } else {
                deferred.resolve(responseBody.Response);
            }
        } else {
            deferred.reject(err);
        }
    });
    return deferred.promise.nodeify(callback);
};
/**
 * Refresh Access Token with Bungie
 * @param refreshToken
 */
Destiny.prototype.getAccessTokenFromRefreshToken = function (refreshToken, callback) {
    var deferred = Q.defer();
    var opts = {
        body: JSON.stringify({
            refreshToken: refreshToken
        }),
        headers: {
            'x-api-key': this.apiKey
        },
        url: util.format('%s/App/GetAccessTokensFromRefreshToken/', servicePlatform)
    };
    request.post(opts, function (err, res, body) {
        if (!err && res.statusCode === 200) {
            var responseBody = JSON.parse(body);
            if (responseBody.ErrorCode !== 1) {
                deferred.reject(new DestinyError(responseBody.ErrorCode || -1,
                    responseBody.Message || '', responseBody.ErrorStatus || ''));
            } else {
                deferred.resolve(responseBody.Response);
            }
        } else {
            deferred.reject(err);
        }
    });
    return deferred.promise.nodeify(callback);
};
/**
 * Get Bungie App Authorization
 * @param state
 * @returns {string}
 */
Destiny.prototype.getAuthorizationUrl = function (state) {
    var deferred = Q.defer();
    deferred.resolve(util.format('%s?state=%s', this.authorizationUrl, state));
    return deferred.promise;
};
/**
 * @function
 * @param characterId {string}
 * @param membershipId {string}
 * @param cookies {Array}
 * @param callback
 * @returns {*|promise}
 */
Destiny.prototype.getActivity = function (characterId, membershipId, accessToken, callback) {
    var deferred = Q.defer();
    var opts = {
        headers: {
            authorization: 'Bearer ' + accessToken,
            'x-api-key': this.apiKey
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
 * @param cookies {Array}
 * @param callback
 * @returns {*|promise}
 * @description Get the details for the member's character provided.
 */
Destiny.prototype.getCharacter = function (membershipId, characterId, accessToken, callback) {
    var deferred = Q.defer();
    var opts = {
        headers: {
            authorization: 'Bearer ' + accessToken,
            'x-api-key': this.apiKey
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
 * @param membershipType {integer}
 * @param callback
 * @returns {*|promise}
 * @description Get character details.
 */
Destiny.prototype.getCharacters = function (membershipId, membershipType, callback) {
    var deferred = Q.defer();
    var opts = {
        headers: {
            'x-api-key': this.apiKey
        },
        url: util.format('%s/Destiny/%s/Account/%s/Summary/', servicePlatform,
            membershipType, membershipId)
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
 * @param membershipType {integer}
 * @param callback
 * @returns {*|promise}
 * @description Get the Bungie member number from the user's display name.
 */
Destiny.prototype.getMembershipIdFromDisplayName = function (displayName, membershipType, callback) {
    var deferred = Q.defer();
    var opts = {
        headers: {
            'x-api-key': this.apiKey
        },
        url: util.format('%s/Destiny/%s/Stats/GetMembershipIdByDisplayName/%s/',
            servicePlatform, membershipType, encodeURIComponent(displayName))
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
 * @param cookies {Array}
 * @param callback
 * @returns {*|promise}
 * @description Get the current user based on the Bungie cookies.
 */
Destiny.prototype.getCurrentUser = function (accessToken, callback) {
    var self = this;
    var deferred = Q.defer();
    var opts = {
        headers: {
            authorization: 'Bearer ' + accessToken,
            'x-api-key': this.apiKey
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
                var gamerTag = user.psnId || user.gamerTag;
                if (!gamerTag) {
                    deferred.reject(new Error('Gamer tag not found.'));
                }
                var membershipType = user.psnId ? membershipTypes.TigerPsn : membershipTypes.TigerXbox;
                self.getMembershipIdFromDisplayName(gamerTag, membershipType)
                    .then(function (membershipId) {
                        if (user) {
                            deferred.resolve({
                                displayName: user.psnId,
                                email: user.email,
                                membershipId: membershipId,
                                membershipType: membershipType,
                                profilePicturePath: user.user.profilePicturePath
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
 * @param cookies {Array}
 * @param callback
 * @returns {*|promise}
 * @description Return the current field test weapons available from the gunsmith.
 */
Destiny.prototype.getFieldTestWeapons = function (characterId, accessToken, callback) {
    var self = this;
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
                        authorization: 'Bearer ' + accessToken,
                        'x-api-key': self.apiKey
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
 * @param cookies {Array}
 * @param callback
 * @returns {*|promise}
 * @description Return the current field test weapons available from the gunsmith.
 */
Destiny.prototype.getFoundryOrders = function (characterId, accessToken, callback) {
    var self = this;
    var deferred = Q.defer();
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
                        authorization: 'Bearer ' + accessToken,
                        'x-api-key': self.apiKey
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
                                var foundryOrdersCategory = _.find(data.saleItemCategories,
                                    function (saleItemCategory) {
                                        return saleItemCategory.categoryTitle === 'Foundry Orders';
                                    });
                                var foundryOrders = {
                                    items: (typeof foundryOrdersCategory === 'object') ?
                                        foundryOrdersCategory.saleItems : [],
                                    nextRefreshDate: data.nextRefreshDate
                                };
                                destinyCache.set('getFoundryOrders', foundryOrders);
                                deferred.resolve(foundryOrders);
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
 * @param cookies {Array}
 * @param callback
 * @returns {*|promise}
 */
Destiny.prototype.getInventory = function (characterId, membershipId, accessToken, callback) {
    var deferred = Q.defer();
    var opts = {
        headers: {
            authorization: 'Bearer ' + accessToken,
            'x-api-key': this.apiKey
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
 * @param cookies {Array}
 * @param callback
 * @returns {*|promise}
 * @description Return the current field test weapons available from the gunsmith.
 */
Destiny.prototype.getIronBannerEventRewards = function (characterId, accessToken, callback) {
    var self = this;
    var deferred = Q.defer();
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
                        authorization: 'Bearer ' + accessToken,
                        'x-api-key': self.apiKey
                    },
                    url: util.format('%s/Destiny/2/MyAccount/Character/%s/Vendor/%s/',
                        servicePlatform, characterId, lordSaladinHash)
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
 * @param cookies {Array}
 * @param callback
 * @returns {*|promise}
 */
Destiny.prototype.getItem = function (itemHash, accessToken, callback) {
    var deferred = Q.defer();
    var opts = {
        headers: {
            authorization: 'Bearer ' + accessToken,
            'x-api-key': this.apiKey
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
Destiny.prototype.getManifest = function (callback) {
    var self = this;
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
 * @param cookies {Array}
 * @param callback
 * @returns {*|promise}
 */
Destiny.prototype.getProgression = function (characterId, membershipId, accessToken, callback) {
    var deferred = Q.defer();
    var opts = {
        headers: {
            authorization: 'Bearer ' + accessToken,
            'x-api-key': this.apiKey
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
 * @param cookies {Array}
 * @param callback
 * @returns {*|promise}
 */
Destiny.prototype.getVendorSummaries = function (characterId, accessToken, callback) {
    var deferred = Q.defer();
    var opts = {
        headers: {
            authorization: 'Bearer ' + accessToken,
            'x-api-key': this.apiKey
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
 * @param cookies {Array}
 * @param callback
 * @returns {*|promise}
 */
var getWeapons = function (characterId, membershipId, accessToken, callback) {
    var deferred = Q.defer();
    var opts = {
        headers: {
            authorization: 'Bearer ' + accessToken,
            'x-api-key': this.apiKey
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
Destiny.prototype.getXur = function (callback) {
    var self = this;
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

exports = module.exports = Destiny;
