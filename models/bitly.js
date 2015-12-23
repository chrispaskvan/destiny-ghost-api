/**
 * A module for managing custom Bitlinks.
 *
 * @module Bitly
 * @summary Create a Short URL
 * @author Chris Paskvan
 * @description Manage custom Bitlinks for a Bitly account identified
 * by an access token within the JSON settings file. For additional reference
 * go to {@link http://dev.bitly.com/api.html}.
 * @requires fs
 * @requires Q
 * @requires request
 * @requires util
 */
'use strict';
var fs = require('fs'),
    Q = require('q'),
    request = require('request'),
    util = require('util');
/**
 * @param {string} bitylSettingsFullPath - Full path to the JSON Bitly settings file.
 * @constructor
 */
var Bitly = function (bitylSettingsFullPath) {
    /**
     * @member {Object}
     * @type {{accessToken: string}} settings
     */
    var settings = JSON.parse(fs.readFileSync(bitylSettingsFullPath || './settings/bitly.json'));
    /**
     * @function
     * @param {string} url - URL to be shortened.
     * @returns {string} - The resulting short URL.
     * @description Transform the provided URL into a custom short URL.
     */
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
