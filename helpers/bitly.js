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
const { post } = require('./request');

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
            url: util.format('https://api-ssl.bitly.com/v4/shorten'),
            data: {
                domain: 'bit.ly',
                group_id: '',
                long_url: longUrl,
            },
            headers: {
                Authorization: `Bearer ${settings.accessToken}`,
            },
        };

        if (typeof longUrl !== 'string') {
            return Promise.reject(new Error('URL is not a string'));
        }

        const { link: shortUrl } = await post(options);

        return shortUrl;
    }
}

module.exports = Bitly;
