/**
 * A module for interacting with the Destiny Tracker web API.
 *
 * @module Destiny
 * @summary Helper functions for accessing the Destiny Tracker web API.
 * @author Chris Paskvan
 * @requires request
 */
const request = require('request');

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
	getVotes(itemHash) {
		const opts = {
			body: { referenceId: itemHash },
			headers: {
				'Content-Type': 'application/json'
			},
			json: true,
			method: 'POST',
			url: `${servicePlatform}/external/reviews`
		};

		return new Promise((resolve, reject) => {
			request.post(opts, function (err, res, body) {
				if (!err && res.statusCode === 200) {
					const { votes } = body;

					resolve(votes);
				} else {
					reject(err);
				}
			});
		});
	}

	/**
	 * Get PVP rank.
	 *
	 * @param itemHash {string}
	 * @returns {Promise<Object>}
	 */
	getRank(itemHash) {
		const insightsQuery = {
			query: 'query Item($hash: Hash!, $modes: [Int]) { itemInsights: item(hash: $hash) { insights(modes: $modes) { rank { kills }}}}',
			variables: {
				hash: `${itemHash}`,
				modes: null
			},
			operationName: 'Item'
		};
		const opts = {
			body: insightsQuery,
			headers: {
				'Content-Type': 'application/json'
			},
			json: true,
			method: 'POST',
			url: `${servicePlatform}/graphql`
		};

		return new Promise((resolve, reject) => {
			request.post(opts, function (err, res, body) {
				if (!err && res.statusCode === 200) {
					const { data: { itemInsights: { insights}} } = body;
					let kills;

					if (insights) {
						({ rank: { kills }} = insights);
					}

					resolve(kills);
				} else {
					reject(err);
				}
			});
		});
	}
}

module.exports = DestinyTrackerService;
