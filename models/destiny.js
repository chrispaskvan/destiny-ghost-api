/**
 * Created by chris on 9/20/15.
 */
var _ = require('underscore'),
    Q = require('q'),
    request = require('request'),
    util = require('util');

var Destiny = function() {
    var apiKey = "3503c07b855443259022ac2fbd90ecdc";
    var service = "https://www.bungie.net/platform/Destiny";
    /**
     * chrispaskvan
     */
    var bungled = "8995567811899303610";
    var bungledid = "B4WjEo6RouRJooIRsFz09dtFh5b0VtrSCAAA";
    var bungleatk = "wa=8L-.hTuc16025ztR4Ju7Jyz1nlggd9.bimyxVFof2OrgAAAA4cS1PUGinSnY2LNyFuVVW0EpA6W5SCAbrenQIHLaOXbcJf1kkWMg3nDIlPT9G-WsWCdL4NS-IO80T5jQaeAD5peJOgUaqC-fafstIVZNIXbx8k0wWZNVGhibIbxyU3TvOi3CY0p2YB-F-CQY6BDVudvN2NU0hDkMPZC4gZMM7qR9raDa6DA7TAj.30a.OGiz6PL47RsNfkAympEaKzYCaeEHAYikA3uwqHryvcup6XRfDN4lIU1PvE5rB55KEWVzW-uaeHt0BDayhEqKHD5wW0N82sPPPUIFEP69r7nDosM_&tk=YAAAADnF-3egcfU0DOiflAuuh9Sy7WHk8VFLZvo.Hds16SOOiO4drYmlTrAuB7RtTV2Yt.yyWLsJgccjYQuhcI5W1NaeGPcIsq7x74b9ywDzKTy9f2JBgb7KXhmxEMcI9a4a2SAAAACzLIOt8ur516h5GUHJpX81XCr1rtpZqqi-os5uyS6Wbw__";
    /**
     * Blue18Dragon
     */
    //var bungled = "5007463693228669224";
    //var bungledid = "B6IkIR9o9EdPmo5fov4MlOQXatPZjMLSCAAA";
    //var bungleatk = "wa=KSFXwn6qjm1rmO5TniWxDYFeo7fcMOxyMyCReUZnyCjgAAAAih.2aXbCvU06Oyq23v1Zq6c7nrQRZ9CronhUC8XDIwLcUvBhu6U1Zd0.EomQIhtWptYg0wE5NY7PhLi1SAyJbH3H4pVWM5p2TkQ88ECSg6el4QdO9FY6qVlXaSRdPGFJn5NfD8lIhzjK9wKUmXiXMmvYaqn4xbeKun4tcChta-tQkBiyU-r6F27RUHpqmODjDQ9HGTvYaNISUxaSmk3VGTMagf4irF3d-jTS1hIIoAnH7K9zFb4KFYjg2wgERFoZLnW8qdvRqBwJMt6WltloA.ysA6.Kku6pgic83zgV0tI_&tk=YAAAAH9TZrIVGKdjdGWGX2xhfjMrAm.k6qP4F6GfdERKJZ1g7T5ZxaM8C75pVhXcVQEwWDYkj-LT75.tnWqpEGcbbgZEMBNef3nY.y1JxksMENNUdM71Nia.X61JXyBp1lh4BSAAAABVylyU..BWSQfiBShM52HtPBYP.UDFOhmDPRgedIKjrQ__";

    var DestinyError = function (code, message, status) {
        var self = this;
        self.code = code;
        self.message = message;
        self.stack = (new Error()).stack;
        self.status = status;
    };
    DestinyError.prototype = Object.create(Error.prototype);
    DestinyError.prototype.constructor = DestinyError;

    var _requestWasSuccessful = function(destinyResponse) {
        if (destinyResponse.ErrorCode === 1) {
            return true;
        } else {
            throw new DestinyError(destinyResponse.ErrorCode || -1, destinyResponse.Message || "", destinyResponse.ErrorStatus || "");
        }
    };
    var getActivity = function (characterId, membershipId) {
        var opts = { url: util.format("%s/2/Account/%s/Character/%s/Activities/", service, membershipId, characterId) };
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

    var getCharacter = function (membershipId, characterId)
    {
        var opts = { url: util.format("%s/2/Account/%s/Character/%s/Complete/", service, membershipId, characterId) };
        opts.headers = {};
        opts.headers['cookie'] = util.format("bungled=%s; bungledid=%s; bungleatk=%s", bungled, bungledid, bungleatk);
        opts.headers['x-api-key'] = apiKey;
        opts.headers['x-csrf'] = bungled;
        var deferred = Q.defer();
        request(opts, function (error, response, body) {
            if (!error && response.statusCode == 200) {
                var character = JSON.parse(body).Response.data;
                deferred.resolve(character);
            }
            else {
                deferred.reject(error);            }
        });
        return deferred.promise;
    };

    var getCharacters = function (membershipId)
    {
        var opts = { url: util.format("%s/2/Account/%s/Summary/", service, membershipId) };
        opts.headers = { 'x-api-key': apiKey };
        var deferred = Q.defer();
        request(opts, function (error, response, body) {
            if (!error && response.statusCode == 200) {
                var characters = JSON.parse(body).Response.data.characters;
                deferred.resolve(characters);
            }
            else {
                deferred.reject(error);
            }
        });
        return deferred.promise;
    };

    var gunSmithHash = "570929315";
    var getFieldTestWeapons = function () {
        var opts = { url: util.format("%s/2/MyAccount/Character/2305843009216592048/Vendor/%s/", service, gunSmithHash) };
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
        var opts = { url: util.format("%s/2/Account/%s/Character/%s/Inventory/", service, membershipId, characterId) };
        opts.headers = {};
        opts.headers['cookie'] = util.format("bungled=%s; bungledid=%s; bungleatk=%s", bungled, bungledid, bungleatk);
        opts.headers['x-api-key'] = apiKey;
        opts.headers['x-csrf'] = bungled;
        var deferred = Q.defer();
        request(opts, function (error, response, body) {
            if (!error && response.statusCode == 200) {
                var character = JSON.parse(body).Response.data;
                deferred.resolve(character);
            }
            else {
                deferred.reject(error);            }
        });
        return deferred.promise;
    };

    var getItem = function (itemHash) {
        var opts = { url: util.format("%s/Manifest/2/%s/", service, itemHash) };
        opts.headers = {};
        opts.headers['cookie'] = util.format("bungled=%s; bungledid=%s; bungleatk=%s", bungled, bungledid, bungleatk);
        opts.headers['x-api-key'] = apiKey;
        opts.headers['x-csrf'] = bungled;
        var deferred = Q.defer();
        request(opts, function (error, response, body) {
            if (!error && response.statusCode == 200) {
                var character = JSON.parse(body);
                deferred.resolve(character);
            }
            else {
                deferred.reject(error);            }
        });
        return deferred.promise;
    };

    var getManifest = function () {
        var opts = {};
        opts.url = util.format("%s/Manifest", service);
        opts.headers = { 'x-api-key': apiKey };
        var deferred = Q.defer();
        request(opts, function (error, response, body) {
            if (!error && response.statusCode == 200) {
                deferred.resolve(JSON.parse(body).Response);
            }
            else {
                deferred.reject(error);
            }
        });
        return deferred.promise;
    };

    var getMembershipIdFromDisplayName = function (displayName) {
        var opts = {};
        opts.url = util.format("%s/2/Stats/GetMembershipIdByDisplayName/%s/", service, displayName);
        opts.headers = { 'x-api-key': apiKey };
        var deferred = Q.defer();
        request(opts, function (error, response, body) {
            if (!error && response.statusCode == 200) {
                deferred.resolve(JSON.parse(body).Response);
            }
            else {
                deferred.reject(error);            }
        });
        return deferred.promise;
    };

    var getProgression = function (characterId, membershipId) {
        var opts = { url: util.format("%s/2/Account/%s/Character/%s/Progression/", service, membershipId, characterId) };
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
                deferred.reject(error);            }
        });
        return deferred.promise;
    }

    var getWeapons = function (characterId, membershipId) {
        var opts = { url: util.format("%s/stats/uniqueweapons/2/%s/%s/", service, membershipId, characterId) };
        opts.headers = {};
        opts.headers['cookie'] = util.format("bungled=%s; bungledid=%s; bungleatk=%s", bungled, bungledid, bungleatk);
        opts.headers['x-api-key'] = apiKey;
        opts.headers['x-csrf'] = bungled;
        var deferred = Q.defer();
        request(opts, function (error, response, body) {
            if (!error && response.statusCode == 200) {
                var weapons = body.Response.data.weapons;
                deferred.resolve(weapons.sort(function(a, b){
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
        });
        return deferred.promise;
    };

    var getXur = function () {
        var opts = { url: util.format("%s/Advisors/Xur/", service) };
        opts.headers = {};
        opts.headers['x-api-key'] = apiKey;
        var deferred = Q.defer();
        request(opts, function (error, response, body) {
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
