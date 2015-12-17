/**
 * Created by chris on 9/20/15.
 */
'use strict';
var _ = require('underscore'),
    NodeCache = require('node-cache'),
    Q = require('q'),
    request = require('request'),
    util = require('util');

var Destiny = function (apiKey, cookies) {
    if (!apiKey) {
        throw new Error('The API key is missing.');
    }
    if (!cookies) {
        throw new Error('The Bungie cookies are missing.');
    }
    var self = this;
    self.apiKey = apiKey;
    self.cookies = cookies;
    var servicePlatform = 'https://www.bungie.net/platform';
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
    var destinyCache = new NodeCache({ stdTTL: 0, checkperiod: 0, useClones: true });

    var _getCookieHeader = function () {
        return _.reduce(self.cookies, function (memo, cookie) {
            return memo + ' ' + cookie.name + '=' + cookie.value + ';';
        }, ' ').trim();
    };
    var _getCookieValueByName = function (cookieName) {
        return _.find(self.cookies, function (cookie) {
            return cookie.name === cookieName;
        }).value;
    };
    var getActivity = function (characterId, membershipId) {
        var opts = {
            headers: {
                cookie:  _getCookieHeader(),
                'x-api-key': self.apiKey,
                'x-csrf': _getCookieValueByName('bungled')
            },
            url: util.format('%s/Destiny/2/Account/%s/Character/%s/Activities/', servicePlatform, membershipId, characterId)
        };
        var deferred = Q.defer();
        request(opts, function (error, response, body) {
            if (!error && response.statusCode === 200) {
                var responseBody = JSON.parse(body);
                if (responseBody.ErrorCode !== 1) {
                    deferred.reject(new DestinyError(responseBody.ErrorCode || -1, responseBody.Message || '', responseBody.ErrorStatus || ''));
                } else {
                    var character = JSON.parse(body).Response;
                    deferred.resolve(character);
                }
            } else {
                deferred.reject(error);
            }
        });
        return deferred.promise;
    };
    var getCharacter = function (membershipId, characterId) {
        var opts = {
            headers: {
                cookie:  _getCookieHeader(),
                'x-api-key': self.apiKey,
                'x-csrf': _getCookieValueByName('bungled')
            },
            url: util.format('%s/Destiny/2/Account/%s/Character/%s/Complete/', servicePlatform, membershipId, characterId)
        };
        var deferred = Q.defer();
        request(opts, function (error, response, body) {
            if (!error && response.statusCode === 200) {
                var responseBody = JSON.parse(body);
                if (responseBody.ErrorCode !== 1) {
                    deferred.reject(new DestinyError(responseBody.ErrorCode || -1, responseBody.Message || '', responseBody.ErrorStatus || ''));
                } else {
                    var character = responseBody.Response.data;
                    deferred.resolve(character);
                }
            } else if (!error && response.statusCode === 99) {
                deferred.reject(new DestinyError(response.statusCode, response.Message));
            } else {
                deferred.reject(error);
            }
        });
        return deferred.promise;
    };
    var getCharacters = function (membershipId) {
        var deferred = Q.defer();
        destinyCache.get(membershipId, function (err, characters) {
            if (characters) {
                setTimeout(function () {
                    deferred.resolve(characters);
                }, 50);
            } else {
                var opts = {
                    headers: {
                        'x-api-key': self.apiKey
                    },
                    url: util.format('%s/Destiny/2/Account/%s/Summary/', servicePlatform, membershipId)
                };
                request(opts, function (error, response, body) {
                    if (!error && response.statusCode === 200) {
                        var responseBody = JSON.parse(body);
                        if (responseBody.ErrorCode !== 1) {
                            deferred.reject(new DestinyError(responseBody.ErrorCode || -1, responseBody.Message || '', responseBody.ErrorStatus || ''));
                        } else {
                            characters = responseBody.Response.data.characters;
                            destinyCache.set(membershipId, characters);
                            deferred.resolve(characters);
                        }
                    } else {
                        deferred.reject(error);
                    }
                });
            }
        });
        return deferred.promise;
    };
    var getMembershipIdFromDisplayName = function (displayName) {
        var opts = {
            headers: {
                'x-api-key': self.apiKey
            },
            url: util.format('%s/Destiny/2/Stats/GetMembershipIdByDisplayName/%s/', servicePlatform, encodeURIComponent(displayName))
        };
        var deferred = Q.defer();
        request(opts, function (error, response, body) {
            if (!error && response.statusCode === 200) {
                deferred.resolve(JSON.parse(body).Response);
            } else {
                deferred.reject(error);
            }
        });
        return deferred.promise;
    };
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
        request(opts, function (error, res, body) {
            if (!error && res.statusCode === 200) {
                var responseBody = JSON.parse(body);
                if (responseBody.Reponse !== undefined || responseBody.ErrorCode !== 1) {
                    deferred.reject(new DestinyError(responseBody.ErrorCode, responseBody.Message, responseBody.Status));
                } else {
                    var user = responseBody.Response;
                    getMembershipIdFromDisplayName(user.psnId)
                        .then(function (membershipId) {
                            if (user) {
                                deferred.resolve({ displayName: user.psnid, email: user.email, membershipId: membershipId });
                            } else {
                                deferred.resolve([]);
                            }
                        });
                }
            } else {
                deferred.reject(error);
            }
        });
        return deferred.promise;
    };
    var gunSmithHash = '570929315';
    var getFieldTestWeapons = function (characterId) {
        var deferred = Q.defer();
        destinyCache.get('getFieldTestWeapons', function (err, saleItems) {
            if (saleItems) {
                setTimeout(function () {
                    deferred.resolve(saleItems);
                }, 50);
            } else {
                var opts = {
                    headers: {
                        cookie:  _getCookieHeader(),
                        'x-api-key': self.apiKey,
                        'x-csrf': _getCookieValueByName('bungled')
                    },
                    url: util.format('%s/Destiny/2/MyAccount/Character/%s/Vendor/%s/', servicePlatform, characterId, gunSmithHash)
                };
                request(opts, function (error, res, body) {
                    if (!error && res.statusCode === 200) {
                        var responseBody = JSON.parse(body);
                        if (responseBody.Reponse !== undefined || responseBody.ErrorCode !== 1) {
                            deferred.reject(new DestinyError(responseBody.ErrorCode, responseBody.Message, responseBody.Status));
                        } else {
                            var data = responseBody.Response.data;
                            if (data) {
                                var saleItemCategories = data.saleItemCategories;
                                var fieldTestWeapons = _.find(saleItemCategories, function (saleItemCategory) {
                                    return saleItemCategory.categoryTitle === 'Field Test Weapons';
                                });
                                deferred.resolve(fieldTestWeapons.saleItems);
                            } else {
                                deferred.resolve([]);
                            }
                        }
                    } else {
                        deferred.reject(error);
                    }
                });
            }
        });
        return deferred.promise;
    };
    var getInventory = function (characterId, membershipId) {
        var opts = {
            headers: {
                cookie:  _getCookieHeader(),
                'x-api-key': self.apiKey,
                'x-csrf': _getCookieValueByName('bungled')
            },
            url: util.format('%s/Destiny/2/Account/%s/Character/%s/Inventory/', servicePlatform, membershipId, characterId)
        };
        var deferred = Q.defer();
        request(opts, function (error, response, body) {
            if (!error && response.statusCode === 200) {
                var responseBody = JSON.parse(body);
                if (responseBody.ErrorCode !== 1) {
                    deferred.reject(new DestinyError(responseBody.ErrorCode || -1, responseBody.Message || '', responseBody.ErrorStatus || ''));
                } else {
                    var character = responseBody.Response.data;
                    deferred.resolve(character);
                }
            } else {
                deferred.reject(error);
            }
        });
        return deferred.promise;
    };
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
        request(opts, function (error, response, body) {
            if (!error && response.statusCode === 200) {
                var responseBody = JSON.parse(body);
                if (responseBody.ErrorCode !== 1) {
                    deferred.reject(new DestinyError(responseBody.ErrorCode || -1, responseBody.Message || '', responseBody.ErrorStatus || ''));
                } else {
                    deferred.resolve(responseBody);
                }
            } else {
                deferred.reject(error);
            }
        });
        return deferred.promise;
    };
    var getManifest = function () {
        var deferred = Q.defer();
        destinyCache.get('getManifest', function (err, manifest) {
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
                request(opts, function (error, response, body) {
                    if (!error && response.statusCode === 200) {
                        deferred.resolve(JSON.parse(body).Response);
                    } else {
                        deferred.reject(error);
                    }
                });
            }
        });
        return deferred.promise;
    };
    var getProgression = function (characterId, membershipId) {
        var opts = {
            headers: {
                cookie:  _getCookieHeader(),
                'x-api-key': self.apiKey,
                'x-csrf': _getCookieValueByName('bungled')
            },
            url: util.format('%s/Destiny/2/Account/%s/Character/%s/Progression/', servicePlatform, membershipId, characterId)
        };
        var deferred = Q.defer();
        request(opts, function (error, response, body) {
            if (!error && response.statusCode === 200) {
                var character = JSON.parse(body).Response;
                deferred.resolve(character);
            } else {
                deferred.reject(error);
            }
        });
        return deferred.promise;
    };
    var getWeapons = function (characterId, membershipId) {
        var opts = {
            headers: {
                cookie:  _getCookieHeader(),
                'x-api-key': self.apiKey,
                'x-csrf': _getCookieValueByName('bungled')
            },
            url: util.format('%s/Destiny/stats/uniqueweapons/2/%s/%s/', servicePlatform, membershipId, characterId)
        };
        var deferred = Q.defer();
        request(opts, function (error, response, body) {
            if (!error && response.statusCode === 200) {
                var weapons = body.Response.data.weapons;
                deferred.resolve(weapons.sort(function (a, b) {
                    if (a.values.uniqueWeaponKillsPrecisionKills.basic.value < b.values.uniqueWeaponKillsPrecisionKills.basic.value) {
                        return -1;
                    }
                    if (a.values.uniqueWeaponKillsPrecisionKills.basic.value > b.values.uniqueWeaponKillsPrecisionKills.basic.value) {
                        return 1;
                    }
                    return 0;
                }));
            } else {
                deferred.reject(error);
            }
        });
        return deferred.promise;
    };
    var getXur = function () {
        var deferred = Q.defer();
        destinyCache.get('getXur', function (err, items) {
            if (items) {
                deferred.resolve(items);
            } else {
                var opts = {
                    headers: {
                        'x-api-key': self.apiKey
                    },
                    url: util.format('%s/Destiny/Advisors/Xur/', servicePlatform)
                };
                request(opts, function (error, response, body) {
                    if (!error && response.statusCode === 200) {
                        var responseBody = JSON.parse(body);
                        if (responseBody.ErrorCode === 1627) {
                            deferred.resolve([]);
                        } else if (responseBody.ErrorCode !== 1) {
                            deferred.reject(new DestinyError(responseBody.ErrorCode || -1, responseBody.Message || '', responseBody.ErrorStatus || ''));
                        } else {
                            var data = responseBody.Response.data;
                            if (data) {
                                var saleItemCategories = data.saleItemCategories;
                                var exotics = _.find(saleItemCategories, function (saleItemCategory) {
                                    return saleItemCategory.categoryTitle === 'Exotic Gear';
                                });
                                destinyCache.set('getXur', exotics.saleItems);
                                deferred.resolve(exotics.saleItems);
                            } else {
                                deferred.resolve([]);
                            }
                        }
                    } else {
                        deferred.reject(error);
                    }
                });
            }
        });
        return deferred.promise;
    };
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
        getWeapons: getWeapons,
        getXur: getXur,
        setAuthenticationCookies: setAuthenticationCookies
    };
};

module.exports = Destiny;
