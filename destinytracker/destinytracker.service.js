/**
 * A module for interacting with the Destiny Tracker web API.
 *
 * @module Destiny
 * @summary Helper functions for accessing the Destiny Tracker web API.
 * @author Chris Paskvan
 * @requires request
 */
const { get, post } = require('../helpers/request');

/**
 * @constant
 * @type {string}
 * @description Base URL for all of the Bungie API services.
 */
const servicePlatform = 'https://api.tracker.gg/api/v1/destiny-2/db';

/**
 * Destiny Tracker Service Class
 */
class DestinyTrackerService {
    /**
     * Get the overall summary of voter data from the reviews.
     *
     * @param itemHash {string}
     * @returns {Promise}
     */
    async getVotes(itemHash) { // eslint-disable-line class-methods-use-this
        const options = {
            data: {
                referenceId: itemHash,
            },
            headers: {
                'Content-Type': 'application/json',
            },
            url: `${servicePlatform}/reviews`,
        };
        const { votes } = await post(options);

        return votes;
    }

    /**
     * Get PVP rank.
     *
     * @param itemHash {string}
     * @returns {Promise<Object>}
     */
    async getRank(itemHash) { // eslint-disable-line class-methods-use-this
        const options = {
            headers: {
                'Content-Type': 'application/json',
            },
            url: `${servicePlatform}/items/${itemHash}/insights`,
        };
        const { data } = await get(options);
        let kills;

        if (data) {
            const { stats } = data;

            if (stats) {
                ({ rank: { kills } } = stats);
            }
        }

        return kills;
    }
}

module.exports = DestinyTrackerService;
