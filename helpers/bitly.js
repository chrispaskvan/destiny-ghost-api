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
const request = require('request');
const util = require('util');
const settings = require('../settings/bitly.json');

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
    static getShortUrl(url) {
        const opts = {
            url: util.format('https://api-ssl.bitly.com/v3/shorten?access_token=%s&longUrl=%s',
                settings.accessToken, encodeURIComponent(url)),
        };

        if (typeof url !== 'string') {
            return Promise.reject(new Error('URL is not a string'));
        }

        return new Promise((resolve, reject) => {
            request(opts, (err, response, body) => {
                if (!err && response.statusCode === 200) {
                    let data;

                    try {
                        ({ data } = JSON.parse(body));
                    } catch (e) {
                        reject(e.message);
                    }

                    resolve(data ? data.url : undefined);
                } else {
                    reject(err);
                }
            });
        });
    }
}

module.exports = Bitly;
