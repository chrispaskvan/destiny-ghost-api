/**
 * A module for interacting with the Bungie Destiny web API.
 *
 * @module Destiny
 * @summary Helper functions for accessing the Destiny web API.
 * @author Chris Paskvan
 * @description Utility functions for requests against the Bungie web API for
 * managing users and destiny characters, etc. For more information check out
 * the wiki at {@link http://bungienetplatform.wikia.com/wiki/Endpoints} or
 * the Bungie web API platform help page {@link https://www.bungie.net/platform/destiny/help/}.
 * @requires _
 * @requires request
 * @requires util
 */
const _ = require('underscore'),
    { apiKey } = require('../settings/bungie.json'),
    request = require('request'),
    util = require('util');
/**
 * Available Membership Types
 * @type {{TigerXbox: number, TigerPsn: number}}
 * @description Membership types as defined by the Bungie Destiny API
 * outlined at {@link http://bungienetplatform.wikia.com/wiki/BungieMembershipType}.
 */
const membershipTypes = {
    TigerXbox: 1,
    TigerPsn: 2
};
/**
 * @constant
 * @type {string}
 * @description Base URL for all of the Bungie API services.
 */
const servicePlatform = 'https://www.bungie.net/platform';
/**
 * @throws API key not found.
 * @constructor
 */
/**
 * Destiny2 Service Class
 */
class Destiny2Service {
    /**
     * @constructor
     * @param cacheService
     */
    constructor(cacheService) {
        this.cacheService = cacheService;
    }

    /**
     * Get the latest Destiny Manifest definition.
     * @returns {Promise}
     * @private
     */
    _getManifest() {
        const opts = {
            headers: {
                'x-api-key': apiKey
            },
            url: util.format('%s/Destiny2/Manifest', servicePlatform)
        };

        return new Promise((resolve, reject) => {
            request.get(opts, (err, res, body) => {
                if (!err && res.statusCode === 200) {
                    const manifest = JSON.parse(body).Response;

                    this.cacheService.setManifest(manifest);

                    resolve(manifest);
                } else {
                    reject(err);
                }
            });
        });
    }

    /**
     * Get the cached Destiny Manifest definition if available, otherwise get the latest from Bungie.
     * @param noCache
     * @returns {Promise}
     */
    getManifest(noCache) {
        return this.cacheService.getManifest()
            .then(manifest => {
                if (!noCache && manifest) {
                    return manifest;
                }

                return this._getManifest();
            });
    }
}

exports = module.exports = Destiny2Service;
