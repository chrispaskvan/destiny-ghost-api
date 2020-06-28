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
const util = require('util');
const { bitly: settings } = require('./config');
const { get } = require('./request');

/**
 * @param {string} bitylSettingsFullPath - Full path to the JSON Bitly settings file.
 * @constructor
 */
class Bitly {
    /**
     * @function
     * @param {string} url - URL to be shortened.
     * @returns {Promise} - The resulting short URL.
     * @description Transform the provided URL into a custom short URL.
     */
    static async getShortUrl(longUrl) {
        const options = {
            url: util.format('https://api-ssl.bitly.com/v3/shorten?access_token=%s&longUrl=%s',
                settings.accessToken, encodeURIComponent(longUrl)),
        };

        if (typeof longUrl !== 'string') {
            return Promise.reject(new Error('URL is not a string'));
        }

        const { data: { url: shortUrl } } = await get(options);

        return shortUrl;
    }
}

module.exports = Bitly;
