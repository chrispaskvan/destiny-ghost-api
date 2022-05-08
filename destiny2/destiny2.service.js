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
const DestinyError = require('../destiny/destiny.error');
const DestinyService = require('../destiny/destiny.service');
const { bungie: { apiKey } } = require('../helpers/config');
const { xurHash } = require('./destiny2.constants');
const { get } = require('../helpers/request');

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
    async #getManifestFromBungie() {
        const options = {
            headers: {
                'x-api-key': apiKey,
            },
            url: `${servicePlatform}/Destiny2/Manifest`,
        };
        const responseBody = await get(options);

        if (responseBody.ErrorCode === 1) {
            const { Response: manifest } = responseBody;

            this.cacheService.setManifest(manifest);

            return manifest;
        }

        throw new DestinyError(
            responseBody.ErrorCode || -1,
            responseBody.Message || '',
            responseBody.ErrorStatus || '',
        );
    }

    /**
     * Get the cached Destiny Manifest definition if available,
     *   otherwise get the latest from Bungie.
     *
     * @param skipCache
     * @returns {Promise}
     */
    async getManifest(skipCache) {
        const manifest = await this.cacheService.getManifest();

        if (!skipCache && manifest) {
            return manifest;
        }

        return this.#getManifestFromBungie();
    }

    /**
     * Search for the Destiny player.
     *
     * @param displayName
     * @returns {Promise}
     */
    async getPlayer(displayName) { // eslint-disable-line class-methods-use-this
        const options = {
            headers: {
                'x-api-key': apiKey,
            },
            url: `${servicePlatform}/Destiny2/SearchDestinyPlayer/All/${displayName}/`,
        };
        const responseBody = await get(options);

        if (responseBody.ErrorCode === 1) {
            const { Response: [player] } = responseBody;

            return player;
        }

        throw new DestinyError(
            responseBody.ErrorCode || -1,
            responseBody.Message || '',
            responseBody.ErrorStatus || '',
        );
    }

    /**
     * Get player PVP statistics.
     *
     * @param membershipId
     * @param membershipType
     */
    // eslint-disable-next-line class-methods-use-this
    async getPlayerStats(membershipId, membershipType) {
        const options = {
            headers: {
                'x-api-key': apiKey,
            },
            url: `${servicePlatform}/Destiny2/${membershipType}/Account/${membershipId}/Stats`,
        };
        const responseBody = await get(options);

        if (responseBody.ErrorCode === 1) {
            const {
                Response: {
                    mergedAllCharacters: {
                        results: {
                            allPvP: {
                                allTime,
                            },
                        },
                    },
                },
            } = responseBody;

            return allTime;
        }

        throw new DestinyError(
            responseBody.ErrorCode || -1,
            responseBody.Message || '',
            responseBody.ErrorStatus || '',
        );
    }

    /**
     * Get user profile.
     *
     * @param membershipId
     * @param membershipType
     * @returns {Promise}
     */
    async getProfile(membershipId, membershipType, skipCache) {
        let characters;

        if (!skipCache) {
            characters = await this.cacheService.getCharacters(membershipId);

            if (characters) return characters;
        }

        try {
            const options = {
                headers: {
                    'x-api-key': apiKey,
                },
                url: `${servicePlatform}/Destiny2/${membershipType}/Profile/${membershipId}?components=Characters`,
            };
            const responseBody = await get(options);

            if (responseBody.ErrorCode === 1) {
                const { Response: { characters: { data } } } = responseBody;

                characters = Object.values(data).map(character => character);
                await this.cacheService.setCharacters(membershipId, characters);

                return characters;
            }

            throw new DestinyError(
                responseBody.ErrorCode || -1,
                responseBody.Message || '',
                responseBody.ErrorStatus || '',
            );
        } catch (err) {
            if (err instanceof DestinyError) throw err;

            const {
                data: {
                    ErrorCode: code,
                    ErrorStatus: status,
                    Message: message = 'Failed to get characters from profile.',
                } = {},
            } = err;

            throw new DestinyError(code, message, status);
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
        const vendor = await this.cacheService.getVendor(xurHash);

        if (vendor) {
            return vendor;
        }

        const options = {
            headers: {
                authorization: `Bearer ${accessToken}`,
                'x-api-key': apiKey,
            },
            url: `${servicePlatform}/Destiny2/${membershipType}/Profile/${membershipId}/Character/${characterId}/Vendors/${xurHash}?components=402`,
        };
        const responseBody = await get(options);

        if (responseBody.ErrorCode === 1) {
            const { Response: { sales: { data } } } = responseBody;
            const itemHashes = Object.entries(data).map(([, value]) => value.itemHash);

            this.cacheService.setVendor(xurHash, itemHashes);

            return itemHashes;
        }

        throw new DestinyError(
            responseBody.ErrorCode || -1,
            responseBody.Message || '',
            responseBody.ErrorStatus || '',
        );
    }
}

module.exports = Destiny2Service;
