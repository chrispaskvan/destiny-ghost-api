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
import DestinyError from '../destiny/destiny.error';
import DestinyService from '../destiny/destiny.service';
import configuration from '../helpers/config';
import log from '../helpers/log';
import { strangeGearOffersHash } from './destiny2.constants';
import { get, post } from '../helpers/request';

const { bungie: { apiKey, host } } = configuration;

/**
 * @constant
 * @type {string}
 * @description Base URL for all of the Bungie API services.
 */
const servicePlatform = `${host}/Platform`;

/**
 * Destiny2 Service Class
 */
class Destiny2Service extends DestinyService {
    /**
     * @protected
     * @type {string}
     */
    _api = 'Destiny2';

    /**
     * Find players by display name.
     *
     * @param displayName
     * @param {int} pageNumber
     * @returns {Promise}
     */
    static async findPlayers(displayName, pageNumber) {
        const options = {
            data: {
                displayNamePrefix: displayName,
            },
            headers: {
                'x-api-key': apiKey,
            },
            url: `${servicePlatform}/User/Search/GlobalName/${pageNumber}/`,
        };
        const responseBody = await post(options);

        if (responseBody.ErrorCode === 1) {
            const { Response: { searchResults } } = responseBody;

            return searchResults;
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
     * @returns {Promise}
     */
    async getPlayerStatistics(membershipId, membershipType) {
        const emptyStatistics = {
            pvp: {
                combatRating: null,
                efficiency: null,
                highestLightLevel: null,
                kda: null,
                kdr: null,
            },
        };

        if (!membershipId || !membershipType) {
            return emptyStatistics;
        }

        let statistics = await this.cacheService.getPlayerStatistics(membershipId);

        if (statistics) return statistics;

        const options = {
            headers: {
                'x-api-key': apiKey,
            },
            url: `${servicePlatform}/Destiny2/${membershipType}/Account/${membershipId}/Stats`,
        };
        const responseBody = await get(options);

        if (responseBody.ErrorCode === 1) {
            const allPvP = responseBody.Response?.mergedAllCharacters?.results?.allPvP;

            if (allPvP && Object.keys(allPvP).length) {
                const {
                    allTime: {
                        combatRating: {
                            basic: { displayValue: combatRating },
                        },
                        efficiency: {
                            basic: { displayValue: efficiency },
                        },
                        highestLightLevel: {
                            basic: { displayValue: highestLightLevel },
                        },
                        killsDeathsAssists: {
                            basic: { displayValue: kda },
                        },
                        killsDeathsRatio: {
                            basic: { displayValue: kdr },
                        },
                    },
                } = allPvP;

                statistics = {
                    pvp: {
                        combatRating,
                        efficiency,
                        highestLightLevel,
                        kda,
                        kdr,
                    },
                };
                await this.cacheService.setPlayerStatistics(membershipId, statistics);

                return statistics;
            }

            return emptyStatistics;
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
        const vendor = await this.cacheService.getVendor(strangeGearOffersHash);

        log.info({
            membershipId,
            membershipType,
            characterId,
        }, 'Fetching Xur\'s inventory ...');

        if (vendor) {
            return vendor;
        }

        const options = {
            headers: {
                authorization: `Bearer ${accessToken}`,
                'x-api-key': apiKey,
            },
            url: `${servicePlatform}/Destiny2/${membershipType}/Profile/${membershipId}/Character/${characterId}/Vendors/${strangeGearOffersHash}?components=402`,
        };
        const responseBody = await get(options);

        if (responseBody.ErrorCode === 1) {
            const { Response: { sales: { data } } } = responseBody;
            const itemHashes = Object.entries(data).map(([, value]) => value.itemHash);

            this.cacheService.setVendor(strangeGearOffersHash, itemHashes);

            return itemHashes;
        }

        throw new DestinyError(
            responseBody.ErrorCode || -1,
            responseBody.Message || '',
            responseBody.ErrorStatus || '',
        );
    }
}

export default Destiny2Service;
