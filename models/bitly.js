/**
 * Created by chris on 11/6/15.
 */
/**
 * Created by chris on 9/20/15.
 */
var Q = require('q'),
    nconf = require("nconf"),

var Bitly = function () {
    nconf.file("./settings/bitly.json");
    var accessToken = nconf.get("accessToken");
    var bitly = new Bitly(accessToken, {});

    var getShortUrl = function (url) {
        var deferred = Q.defer();
        bitly.shorten(url)
            .then(function(response) {
                deferred.resolve(response.data.url);
            }, function(error) {
                throw error;
            });
        return deferred.promise;
    };
    return {
        getShortUrl: getShortUrl
    }
};

module.exports = Bitly;
