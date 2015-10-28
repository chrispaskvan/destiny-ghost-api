/**
 * Created by chris on 9/20/15.
 */
var _ = require('underscore'),
    nconf = require("nconf"),
    Q = require("q"),
    request = require("request"),
    util = require("util");

var Destiny = function () {
    nconf.file('./settings/chrispaskvan.json');
    var apiKey = nconf.get("apiKey"),
        bungled = nconf.get("bungled"),
        bungledid = nconf.get("bungledid"),
        bungleatk = nconf.get("bungleatk");
    var service = "https://www.bungie.net/platform/Destiny";
    var DestinyError = function (code, message, status) {
        var self = this;
        self.code = code;
        self.message = message;
        self.stack = (new Error()).stack;
        self.status = status;
    };
    DestinyError.prototype = Object.create(Error.prototype);
    DestinyError.prototype.constructor = DestinyError;

    var _requestWasSuccessful = function (destinyResponse) {
        if (destinyResponse.ErrorCode === 1) {
            return true;
        } else {
            throw new DestinyError(destinyResponse.ErrorCode || -1, destinyResponse.Message || "", destinyResponse.ErrorStatus || "");
        }
    };
    var getActivity = function (characterId, membershipId) {
        var opts = {url: util.format("%s/2/Account/%s/Character/%s/Activities/", service, membershipId, characterId)};
        opts.headers = {};
        opts.headers['cookie'] = util.format("bungled=%s; bungledid=%s; bungleatk=%s", bungled, bungledid, bungleatk);
        opts.headers['x-api-key'] = apiKey;
        opts.headers['x-csrf'] = bungled;
        var deferred = Q.defer();
        request(opts, function (error, response, body) {
            if (!error && response.statusCode == 200) {
                var character = JSON.parse(body).Response;
                deferred.resolve(character);
            }
            else {
                deferred.reject(error);
            }
        });
        return deferred.promise;
    };

    var getCharacter = function (membershipId, characterId) {
        var opts = {url: util.format("%s/2/Account/%s/Character/%s/Complete/", service, membershipId, characterId)};
        opts.headers = {};
        opts.headers['cookie'] = util.format("bungled=%s; bungledid=%s; bungleatk=%s", bungled, bungledid, bungleatk);
        opts.headers['x-api-key'] = apiKey;
        opts.headers['x-csrf'] = bungled;
        var deferred = Q.defer();
        request(opts, function (error, response, body) {
            try {
                if (!error && response.statusCode == 200) {
                    var character = JSON.parse(body).Response.data;
                    deferred.resolve(character);
                }
                else {
                    deferred.reject(error);
                }
            } catch (e) {
                deferred.reject(e);
            }
        });
        return deferred.promise;
    };

    var getCharacters = function (membershipId) {
        var opts = {url: util.format("%s/2/Account/%s/Summary/", service, membershipId)};
        opts.headers = {'x-api-key': apiKey};
        var deferred = Q.defer();
        request(opts, function (error, response, body) {
            try {
                if (!error && response.statusCode == 200) {
                    var responseBody = JSON.parse(body);
                    if (!_requestWasSuccessful(responseBody)) {
                        // ToDo
                    } else {
                        var data = responseBody.Response.data;
                        var characters = data.characters;
                        deferred.resolve(characters);
                    }
                }
                else {
                    deferred.reject(error);
                }
            } catch (e) {
                deferred.reject(e);
            }
        });
        return deferred.promise;
    };

    var gunSmithHash = "570929315";
    var getFieldTestWeapons = function () {
        var opts = {url: util.format("%s/2/MyAccount/Character/2305843009216592048/Vendor/%s/", service, gunSmithHash)};
        opts.headers = {};
        opts.headers['cookie'] = util.format("bungled=%s; bungledid=%s; bungleatk=%s", bungled, bungledid, bungleatk);
        opts.headers['x-api-key'] = apiKey;
        opts.headers['x-csrf'] = bungled;
        var deferred = Q.defer();
        request(opts, function (error, res, body) {
            try {
                if (!error && res.statusCode == 200) {
                    var responseBody = JSON.parse(body);
                    if (!_requestWasSuccessful(responseBody)) {
                        // ToDo
                    } else {
                        var data = responseBody.Response.data;
                        if (data) {
                            var saleItemCategories = data.saleItemCategories;
                            var fieldTestWeapons = _.find(saleItemCategories, function (saleItemCategory) {
                                return saleItemCategory.categoryTitle === "Field Test Weapons";
                            });
                            deferred.resolve(fieldTestWeapons.saleItems);
                        } else {
                            deferred.resolve([]);
                        }
                    }
                }
                else {
                    deferred.reject(error);
                }
            } catch (e) {
                deferred.reject(e);
            }
        });
        return deferred.promise;
    };

    var getInventory = function (characterId, membershipId) {
        var opts = {url: util.format("%s/2/Account/%s/Character/%s/Inventory/", service, membershipId, characterId)};
        opts.headers = {};
        opts.headers['cookie'] = util.format("bungled=%s; bungledid=%s; bungleatk=%s", bungled, bungledid, bungleatk);
        opts.headers['x-api-key'] = apiKey;
        opts.headers['x-csrf'] = bungled;
        var deferred = Q.defer();
        request(opts, function (error, response, body) {
            try {
                if (!error && response.statusCode == 200) {
                    var responseBody = JSON.parse(body);
                    if (!_requestWasSuccessful(responseBody)) {
                        // ToDo
                    } else {
                        var character = responseBody.Response.data;
                        deferred.resolve(character);
                    }
                }
                else {
                    deferred.reject(error);
                }
            } catch (e) {
                deferred.reject(e);
            }
        });
        return deferred.promise;
    };

    var getItem = function (itemHash) {
        var opts = {url: util.format("%s/Manifest/2/%s/", service, itemHash)};
        opts.headers = {};
        opts.headers['cookie'] = util.format("bungled=%s; bungledid=%s; bungleatk=%s", bungled, bungledid, bungleatk);
        opts.headers['x-api-key'] = apiKey;
        opts.headers['x-csrf'] = bungled;
        var deferred = Q.defer();
        request(opts, function (error, response, body) {
            try {
                if (!error && response.statusCode == 200) {
                    var character = JSON.parse(body);
                    deferred.resolve(character);
                }
                else {
                    deferred.reject(error);
                }
            } catch (e) {
                deferred.reject(e);
            }
        });
        return deferred.promise;
    };

    var getManifest = function () {
        var opts = {};
        opts.url = util.format("%s/Manifest", service);
        opts.headers = {'x-api-key': apiKey};
        var deferred = Q.defer();
        request(opts, function (error, response, body) {
            try {
                if (!error && response.statusCode == 200) {
                    deferred.resolve(JSON.parse(body).Response);
                }
                else {
                    deferred.reject(error);
                }
            } catch (e) {
                deferred.reject(e);
            }
        });
        return deferred.promise;
    };

    var getMembershipIdFromDisplayName = function (displayName) {
        var opts = {};
        opts.url = util.format("%s/2/Stats/GetMembershipIdByDisplayName/%s/", service, displayName);
        opts.headers = {'x-api-key': apiKey};
        var deferred = Q.defer();
        request(opts, function (error, response, body) {
            try {
                if (!error && response.statusCode == 200) {
                    deferred.resolve(JSON.parse(body).Response);
                }
                else {
                    deferred.reject(error);
                }
            } catch (e) {
                deferred.reject(e);
            }
        });
        return deferred.promise;
    };

    var getProgression = function (characterId, membershipId) {
        var opts = {url: util.format("%s/2/Account/%s/Character/%s/Progression/", service, membershipId, characterId)};
        opts.headers = {};
        opts.headers['cookie'] = util.format("bungled=%s; bungledid=%s; bungleatk=%s", bungled, bungledid, bungleatk);
        opts.headers['x-api-key'] = apiKey;
        opts.headers['x-csrf'] = bungled;
        var deferred = Q.defer();
        request(opts, function (error, response, body) {
            try {
                if (!error && response.statusCode == 200) {
                    var character = JSON.parse(body).Response;
                    deferred.resolve(character);
                }
                else {
                    deferred.reject(error);
                }
            } catch (e) {
                deferred.reject(e);
            }
        });
        return deferred.promise;
    }

    var getWeapons = function (characterId, membershipId) {
        var opts = {url: util.format("%s/stats/uniqueweapons/2/%s/%s/", service, membershipId, characterId)};
        opts.headers = {};
        opts.headers['cookie'] = util.format("bungled=%s; bungledid=%s; bungleatk=%s", bungled, bungledid, bungleatk);
        opts.headers['x-api-key'] = apiKey;
        opts.headers['x-csrf'] = bungled;
        var deferred = Q.defer();
        request(opts, function (error, response, body) {
            try {
                if (!error && response.statusCode == 200) {
                    var weapons = body.Response.data.weapons;
                    deferred.resolve(weapons.sort(function (a, b) {
                        if (a.values.uniqueWeaponKillsPrecisionKills.basic.value < b.values.uniqueWeaponKillsPrecisionKills.basic.value) {
                            return -1;
                        } else if (a.values.uniqueWeaponKillsPrecisionKills.basic.value > b.values.uniqueWeaponKillsPrecisionKills.basic.value) {
                            return 1;
                        } else {
                            return 0;
                        }
                    }));
                }
                else {
                    deferred.reject(error);
                }
            } catch (e) {
                deferred.reject(e);
            }
        });
        return deferred.promise;
    };

    var getXur = function () {
        var opts = {url: util.format("%s/Advisors/Xur/", service)};
        opts.headers = {};
        opts.headers['x-api-key'] = apiKey;
        var deferred = Q.defer();
        request(opts, function (error, response, body) {
            try {
                if (!error && response.statusCode == 200) {
                    var data = JSON.parse(body).Response.data;
                    if (data) {
                        var saleItemCategories = data.saleItemCategories;
                        var exotics = _.find(saleItemCategories, function (saleItemCategory) {
                            return saleItemCategory.categoryTitle === "Exotic Gear";
                        });
                        deferred.resolve(exotics.saleItems);
                    } else {
                        deferred.resolve([]);
                    }
                }
                else {
                    deferred.reject(error);
                }
            } catch (e) {
                deferred.reject(e);
            }
        });
        return deferred.promise;
    };

    return {
        getActivity: getActivity,
        getCharacter: getCharacter,
        getCharacters: getCharacters,
        getFieldTestWeapons: getFieldTestWeapons,
        getInventory: getInventory,
        getItem: getItem,
        getManifest: getManifest,
        getMembershipIdFromDisplayName: getMembershipIdFromDisplayName,
        getProgression: getProgression,
        getWeapons: getWeapons,
        getXur: getXur
    }
};

module.exports = Destiny;
