// @ts-check
import DestinyCache from '../destiny/destiny.cache.js';

const charactersExpiration = 86400; // 24 hours
const playerStatisticsExpiration = 3600; // 1 hour

/**
 * A Destiny 2 character from the Profile endpoint's Characters component.
 * Bungie returns many more fields; only the ones this application reads are modeled.
 * @typedef {Object} Destiny2Character
 * @property {string} characterId
 * @property {number} classHash
 * @property {number} light - Power level
 * @property {string} emblemPath
 * @property {string} emblemBackgroundPath
 */

/**
 * A player's PVP statistics, flattened to the display values this application caches.
 * Fields are null when Bungie has no all-time PVP data for the player.
 * @typedef {Object} PlayerStatistics
 * @property {{
 *     combatRating: string | null,
 *     efficiency: string | null,
 *     highestLightLevel: string | null,
 *     kda: string | null,
 *     kdr: string | null,
 * }} pvp
 */

/**
 * Destiny Cache Class
 */
class Destiny2Cache extends DestinyCache {
    /**
     * Cache key for the latest Destiny Manifest cached.
     * @protected
     * @type {string}
     */
    _manifestKey = 'destiny2-manifest';

    /**
     * @param {...(string | number)} teeth
     * @returns {string}
     */
    static #getCharactersCacheKey(...teeth) {
        return ['characters', ...teeth].join('-');
    }

    /**
     * @param {...(string | number)} teeth
     * @returns {string}
     */
    static #getPlayerStatisticsCacheKey(...teeth) {
        return ['player-statistics', ...teeth].join('-');
    }

    /**
     * Get the cached list of characters for the user.
     * @param {string} membershipId
     * @returns {Promise<Destiny2Character[] | undefined>}
     */
    async getCharacters(membershipId) {
        const res = await this.client.get(Destiny2Cache.#getCharactersCacheKey(membershipId));

        return res ? JSON.parse(res) : undefined;
    }

    /**
     * Get the cached statistics for the player.
     * @param {string} membershipId
     * @returns {Promise<PlayerStatistics | undefined>}
     */
    async getPlayerStatistics(membershipId) {
        const res = await this.client.get(Destiny2Cache.#getPlayerStatisticsCacheKey(membershipId));

        return res ? JSON.parse(res) : undefined;
    }

    /**
     * Set the list of characters for the user.
     * @param {string} membershipId
     * @param {Destiny2Character[]} characters
     * @returns {Promise<string>}
     */
    async setCharacters(membershipId, characters) {
        if (!(membershipId && typeof membershipId === 'string')) {
            throw new Error('membershipId is a required string');
        }

        if (!characters?.length) {
            throw new Error('characters is a required and must be a nonempty array');
        }

        return await this.client.setEx(
            Destiny2Cache.#getCharactersCacheKey(membershipId),
            charactersExpiration,
            JSON.stringify(characters),
        );
    }

    /**
     * Set the statistics for the player.
     * @param {string} membershipId
     * @param {PlayerStatistics} statistics
     * @returns {Promise<string>}
     */
    async setPlayerStatistics(membershipId, statistics) {
        if (!(membershipId && typeof membershipId === 'string')) {
            throw new Error('membershipId is a required string');
        }

        if (!(statistics && Object.keys(statistics).length)) {
            throw new Error('statistics are required and must not be an empty object');
        }

        return await this.client.setEx(
            Destiny2Cache.#getPlayerStatisticsCacheKey(membershipId),
            playerStatisticsExpiration,
            JSON.stringify(statistics),
        );
    }
}

export default Destiny2Cache;
export { charactersExpiration, playerStatisticsExpiration };
