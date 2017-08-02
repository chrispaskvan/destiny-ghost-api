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
var Q = require('q'),
    request = require('request'),
    settings = require('../settings/bitly.json'),
    util = require('util');
/**
 * @param {string} bitylSettingsFullPath - Full path to the JSON Bitly settings file.
 * @constructor
 */
var Bitly = {
    /**
     * @function
     * @param {string} url - URL to be shortened.
     * @returns {string} - The resulting short URL.
     * @description Transform the provided URL into a custom short URL.
     */
    getShortUrl: function (url) {
        var data;
        var deferred = Q.defer();
        var opts = { url: util.format('https://api-ssl.bitly.com/v3/shorten?access_token=%s&longUrl=%s',
            settings.accessToken, encodeURIComponent(url))};

        if (typeof url !== 'string') {
            deferred.reject('URL is not a string');
        } else {
            request(opts, function (error, response, body) {
                if (!error && response.statusCode === 200) {
                    try {
                        data = JSON.parse(body).data;
                    } catch (e) {
                        deferred.reject(e.message);
                    }
                    deferred.resolve(data ? data.url : undefined);
                } else {
                    deferred.reject(error);
                }
            });
        }

        return deferred.promise;
    }
};

exports = module.exports = Bitly;
