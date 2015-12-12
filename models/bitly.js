/**
 * Created by chris on 11/6/15.
 * Reference: http://dev.bitly.com/api.html
 */
'use strict';
var fs = require('fs'),
    Q = require('q'),
    request = require('request'),
    util = require('util');

var Bitly = function (bitylSettingsFullPath) {
    var settings = JSON.parse(fs.readFileSync(bitylSettingsFullPath || './settings/bitly.json'));
    var getShortUrl = function (url) {
        var opts = { url: util.format('https://api-ssl.bitly.com/v3/shorten?access_token=%s&longUrl=%s',
            settings.accessToken, encodeURIComponent(url))};
        var deferred = Q.defer();
        request(opts, function (error, response, body) {
            if (!error && response.statusCode === 200) {
                var data = JSON.parse(body).data;
                deferred.resolve(data.url);
            } else {
                deferred.reject(error);
            }
        });
        return deferred.promise;
    };
    return {
        getShortUrl: getShortUrl
    };
};

module.exports = Bitly;
