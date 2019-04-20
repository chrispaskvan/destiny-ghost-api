/**
 * A module for interacting with the Destiny Tracker web API.
 *
 * @module Destiny
 * @summary Helper functions for accessing the Destiny Tracker web API.
 * @author Chris Paskvan
 * @requires request
 */
const { post } = require('../helpers/request');

/**
 * @constant
 * @type {string}
 * @description Base URL for all of the Bungie API services.
 */
const servicePlatform = 'https://db-api.destinytracker.com/api';

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
	async getVotes(itemHash) {
		const options = {
			data: {
				referenceId: itemHash
			},
			headers: {
				'Content-Type': 'application/json'
			},
			url: `${servicePlatform}/external/reviews`
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
	async getRank(itemHash) {
		const insightsQuery = {
			query: 'query Item($hash: Hash!, $modes: [Int]) { itemInsights: item(hash: $hash) { insights(modes: $modes) { rank { kills }}}}',
			variables: {
				hash: `${itemHash}`,
				modes: null
			},
			operationName: 'Item'
		};
		const options = {
			data: insightsQuery,
			headers: {
				'Content-Type': 'application/json'
			},
			url: `${servicePlatform}/graphql`
		};
		const { data: { itemInsights: { insights}} } = await post(options);
		let kills;

		if (insights) {
			({ rank: { kills }} = insights);
		}

		return kills;
	}
}

module.exports = DestinyTrackerService;
