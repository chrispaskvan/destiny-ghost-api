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
 */
const DestinyError = require('../destiny/destiny.error'),
    DestinyService = require('../destiny/destiny.service'),
    { apiKey } = require('../settings/bungie.json'),
	{ xurHash } = require('./destiny2.constants'),
	axios = require('axios');

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
     * Get the latest Destiny Manifest definition.
     *
     * @returns {Promise}
     * @private
     */
    async _getManifest() {
	    const { data: responseBody } = await axios({
		    headers: {
			    'x-api-key': apiKey
		    },
		    method: 'get',
		    url: `${servicePlatform}/Destiny2/Manifest`
	    });

		if (responseBody.ErrorCode !== 1) {
			throw new DestinyError(responseBody.ErrorCode || -1,
				responseBody.Message || '', responseBody.ErrorStatus || '');
		} else {
			const { Response: manifest } = responseBody;

			this.cacheService.setManifest(manifest);

			return manifest;
		}
    }

	/**
	 * Get Clan leaderboard.
	 *
	 * @param membershipId
	 * @param membershipType
	 * @param accessToken
	 * @returns {Promise}
	 */
    async getLeaderboard(clanId, membershipId, membershipType, accessToken) {
		const { data: responseBody } = await axios({
			headers: {
				authorization: 'Bearer ' + accessToken,
				'x-api-key': apiKey
			},
			method: 'get',
			url: `${servicePlatform}/Destiny2/Stats/Leaderboards/${membershipType}/${membershipId}/${clanId}`
		});

		if (responseBody.ErrorCode === 1) {
			const { Response: { characters: { data }}} = responseBody;
			const characters = Object.keys(data).map(character => data[character]);

			return characters;
		} else {
			throw new DestinyError(responseBody.ErrorCode || -1,
				responseBody.Message || '', responseBody.ErrorStatus || '');
		}
	}

    /**
     * Get the cached Destiny Manifest definition if available, otherwise get the latest from Bungie.
     *
     * @param noCache
     * @returns {Promise}
     */
    async getManifest(noCache) {
        const manifest = await this.cacheService.getManifest();

        if (!noCache && manifest) {
            return manifest;
        }

        return this._getManifest();
    }

	/**
	 * Search for the Destiny player.
	 *
	 * @param displayName
	 * @returns {Promise}
	 */
	async getPlayer(displayName) {
		const { data: responseBody } = await axios(`${servicePlatform}/Destiny2/SearchDestinyPlayer/All/${displayName}/`, {
			headers: {
				'x-api-key': apiKey,
				time: true
			},
			method: 'get'
		});

	    if (responseBody.ErrorCode === 1) {
		    const { Response: [player]} = responseBody;

		    return player;
	    } else {
		    throw new DestinyError(responseBody.ErrorCode || -1,
			    responseBody.Message || '', responseBody.ErrorStatus || '');
	    }
    }

	/**
	 * Get player PVP statistics.
	 *
	 * @param membershipId
	 * @param membershipType
	 */
	async getPlayerStats(membershipId, membershipType) {
		const { data: responseBody } = await axios.get(`${servicePlatform}/Destiny2/${membershipType}/Account/${membershipId}/Stats`, {
			headers: {
				'x-api-key': apiKey,
				time: true
			},
			method: 'get'
		});

		if (responseBody.ErrorCode === 1) {
			const { Response: { mergedAllCharacters: { results: { allPvP: { allTime }}}}} = responseBody;

			return allTime;
		} else {
			throw new DestinyError(responseBody.ErrorCode || -1,
				responseBody.Message || '', responseBody.ErrorStatus || '');
		}
    }

	/**
	 * Get user profile.
	 *
	 * @param membershipId
	 * @param membershipType
	 * @returns {Promise}
	 */
	async getProfile(membershipId, membershipType) {
		const { data: responseBody } = await axios({
			headers: {
				'x-api-key': apiKey,
				method: 'GET',
				time: true
			},
			method: 'get',
			url: `${servicePlatform}/Destiny2/${membershipType}/Profile/${membershipId}?components=Characters`
		});

		if (responseBody.ErrorCode === 1) {
			const { Response: { characters: { data }}} = responseBody;
			const characters = Object.keys(data).map(character => data[character]);

			return characters;
		} else {
			throw new DestinyError(responseBody.ErrorCode || -1,
				responseBody.Message || '', responseBody.ErrorStatus || '');
		}
	}

	/**
	 * Get Xur's inventory.
	 *
	 * @param membershipId
	 * @param membershipType
	 * @param characterId
	 * @param accessToken
	 * @returns {Promise}
	 */
	async getXur(membershipId, membershipType, characterId, accessToken) {
		const { data: responseBody } = await axios({
			headers: {
				authorization: 'Bearer ' + accessToken,
				'x-api-key': apiKey
			},
			method: 'get',
			time: true,
			url: `${servicePlatform}/Destiny2/${membershipType}/Profile/${membershipId}/Character/${characterId}/Vendors/${xurHash}?components=402`
		});

		if (responseBody.ErrorCode === 1) {
			const { Response: {  sales: { data }}} = responseBody;
			const itemHashes = Object.entries(data).map(([, value]) => value.itemHash);

			return itemHashes;
		} else {
			throw new DestinyError(responseBody.ErrorCode || -1,
				responseBody.Message || '', responseBody.ErrorStatus || '');
		}
	}
}

module.exports = Destiny2Service;
