import DestinyCache from '../destiny/destiny.cache';

const charactersExpiration = 86400; // 24 hours
const playerStatisticsExpiration = 3600; // 1 hour

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

    constructor(options = {}) {
        super(options);
    }

    /**
     * @param teeth
     * @returns {string}
     */
    static #getCharactersCacheKey(...teeth) {
        return ['characters', ...teeth].join('-');
    }

    /**
     * @param teeth
     * @returns {string}
     */
    static #getPlayerStatisticsCacheKey(...teeth) {
        return ['player-statistics', ...teeth].join('-');
    }

    /**
     * Get the cached list of characters for the user.
     * @param {*} membershipId
     */
    async getCharacters(membershipId) {
        const res = await this.client.get(Destiny2Cache.#getCharactersCacheKey(membershipId));

        return res ? JSON.parse(res) : undefined;
    }

    /**
     * Get the cached statistics for the player.
     * @param {*} membershipId
     */
    async getPlayerStatistics(membershipId) {
        const res = await this.client.get(Destiny2Cache.#getPlayerStatisticsCacheKey(membershipId));

        return res ? JSON.parse(res) : undefined;
    }

    /**
     * Set the list of characters for the user.
     * @param {*} membershipId
     * @param {*} characters
     */
    async setCharacters(membershipId, characters) {
        if (!(membershipId && typeof membershipId === 'string')) {
            throw new Error('membershipId is a required string.');
        }

        if (!(characters && characters.length)) {
            throw new Error('characters is a required and must be a nonempty array.');
        }

        return await this.client.setEx(
            Destiny2Cache.#getCharactersCacheKey(membershipId),
            charactersExpiration,
            JSON.stringify(characters),
        );
    }

    /**
     * Set the statistics for the player.
     * @param {*} membershipId
     * @param {*} statistics
     */
    async setPlayerStatistics(membershipId, statistics) {
        if (!(membershipId && typeof membershipId === 'string')) {
            throw new Error('membershipId is a required string.');
        }

        if (!(statistics && Object.keys(statistics).length)) {
            throw new Error('statistics are required and must not be an empty object.');
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
