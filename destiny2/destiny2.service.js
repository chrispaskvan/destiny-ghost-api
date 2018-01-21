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
const DestinyError = require('../destiny/destiny.error'),
    DestinyService = require('../destiny/destiny.service'),
    { apiKey } = require('../settings/bungie.json'),
	{ xurHash } = require('./destiny2.constants'),
    request = require('request'),
    util = require('util');

/**
 * @constant
 * @type {string}
 * @description Base URL for all of the Bungie API services.
 */
const servicePlatform = 'https://www.bungie.net/Platform';

/**
 * Destiny2 Service Class
 */
class Destiny2Service extends DestinyService {
    /**
     * @constructor
     * @param options
     */
    constructor(options) {
        super(options);
    }

    /**
     * Get the latest Destiny Manifest definition.
     *
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
					const responseBody = JSON.parse(body);

					if (responseBody.ErrorCode !== 1) {
						reject(new DestinyError(responseBody.ErrorCode || -1,
							responseBody.Message || '', responseBody.ErrorStatus || ''));
					} else {
						const { Response: manifest } = responseBody;

						this.cacheService.setManifest(manifest);

						resolve(manifest);
					}
                } else {
                    reject(err);
                }
            });
        });
    }

	/**
	 *
	 * @param membershipId
	 * @param membershipType
	 * @param accessToken
	 * @returns {Promise}
	 */
    getLeaderboard(membershipId, membershipType, accessToken) {
		const opts = {
			headers: {
				authorization: 'Bearer ' + accessToken,
				'x-api-key': apiKey
			},
			url: util.format('%s/Destiny2/Stats/Leaderboards/%s/%s/2305843009266849896', servicePlatform,
				membershipType, membershipId)
		};

		return new Promise((resolve, reject) => {
			request.get(opts, function (err, res, body) {
				if (!err && res.statusCode === 200) {
					const responseBody = JSON.parse(body);

					if (responseBody.ErrorCode === 1) {
						const { Response: { characters: { data }}} = responseBody;
						const characters = Object.keys(data).map(character => data[character]);

						resolve(characters);
					} else {
						reject(new DestinyError(responseBody.ErrorCode || -1,
							responseBody.Message || '', responseBody.ErrorStatus || ''));
					}
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

	/**
	 * Get user profile.
	 * @param membershipId
	 * @param membershipType
	 * @returns {Promise}
	 */
	getProfile(membershipId, membershipType) {
		const opts = {
			headers: {
				'x-api-key': apiKey
			},
			url: util.format('%s/Destiny2/%s/Profile/%s?components=Characters', servicePlatform,
				membershipType, membershipId)
		};

		return new Promise((resolve, reject) => {
			request.get(opts, function (err, res, body) {
				if (!err && res.statusCode === 200) {
					const responseBody = JSON.parse(body);

					if (responseBody.ErrorCode === 1) {
						const { Response: { characters: { data }}} = responseBody;
						const characters = Object.keys(data).map(character => data[character]);

						resolve(characters);
					} else {
						reject(new DestinyError(responseBody.ErrorCode || -1,
							responseBody.Message || '', responseBody.ErrorStatus || ''));
					}
				} else {
					reject(err);
				}
			});
		});
	}

	/**
	 * Get Xur's inventory.
	 * @param membershipId
	 * @param membershipType
	 * @param characterId
	 * @param accessToken
	 * @returns {Promise}
	 */
	getXur(membershipId, membershipType, characterId, accessToken) {
		const opts = {
			headers: {
				authorization: 'Bearer ' + accessToken,
				'x-api-key': apiKey
			},
			url: util.format('%s/Destiny2/%s/Profile/%s/Character/%s/Vendors/%s?components=None', servicePlatform,
				membershipType, membershipId, characterId, xurHash)
		};

		return new Promise((resolve, reject) => {
			request.get(opts, function (err, res, body) {
				if (!err && res.statusCode === 200) {
					const responseBody = JSON.parse(body);

					if (responseBody.ErrorCode === 1) {
						const { Response: {  vendor }} = responseBody;

						resolve(vendor);
					} else {
						reject(new DestinyError(responseBody.ErrorCode || -1,
							responseBody.Message || '', responseBody.ErrorStatus || ''));
					}
				} else {
					reject(err);
				}
			});
		});
	}
}

module.exports = Destiny2Service;
