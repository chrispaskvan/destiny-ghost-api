/**
 * A module for handling Twilio requests and responses.
 *
 * @module twilioController
 * @author Chris Paskvan
 * @requires _
 * @requires Bitly
 * @requires fs
 * @requires Ghost
 * @requires Notifications
 * @requires path
 * @requires Q
 * @requires S
 * @requires twilio
 * @requires User
 * @requires World
 */
const _ = require('underscore'),
	Ghost = require('../helpers/ghost'),
	MessagingResponse = require('twilio').twiml.MessagingResponse,
	S = require('string'),
	World2 = require('../helpers/world2'),
	bitly = require('../helpers/bitly'),
	log = require('../helpers/log'),
	twilio = require('twilio'),
	{ attributes, authToken } = require('../settings/twilio.' + process.env.NODE_ENV + '.json');


class TwilioController {
	/**
	 * @constructor
	 * @param options
	 */
	constructor(options = {}) {
		this.authentication = options.authenticationService;
		this.destiny = options.destinyService;
		this.ghost = new Ghost({
			destinyService: options.destinyService
		});
		this.users = options.userService;
	}

	/**
	 * Search database.
	 * @param item {string}
	 * @returns {*|promise}
	 * @private
	 */
	async _getItem(item) {
		const world = new World2();
		let promises = [];

		try {
			const worldDatabasePath = await this.ghost.getWorldDatabasePath();

			await world.open(worldDatabasePath);
			_.each(item.itemCategoryHashes, itemCategoryHash => {
				promises.push(world.getItemCategory(itemCategoryHash));
			});

			const itemCategories = await Promise.all(promises);
			const filteredCategories = _.filter(itemCategories, itemCategory => itemCategory.hash > 1);
			const sortedCategories = _.sortBy(filteredCategories,
				itemCategory =>	itemCategory.hash);
			const itemCategory =
				_.reduce(sortedCategories, (memo, itemCategory) => (memo + itemCategory.shortTitle + ' '), ' ')
					.trim();

			world.close();

			return [{
				itemCategory: (item.inventory ? (item.inventory.tierTypeName + ' ') : '') + itemCategory +
				(filteredCategories.length < 2 ? (' ' + item.itemTypeDisplayName) : ''),
				icon: 'https://www.bungie.net' + item.displayProperties.icon,
				itemHash: item.hash,
				itemName: item.displayProperties.name,
				itemType: item.itemType
			}];
		} catch (err) {
			world.close();
			throw err;
		}
	}

	/**
	 * Random responses for unexpected errors.
	 * @returns {string}
	 * @private
	 */
	static _getRandomResponseForAnError() {
		const responses = [
			'Sorry. I lost your message in the Ascendant realm. Blame Oryx.',
			'Skolas escaped the Prison of Elders again. He must be responsible for this mishap.',
			'Have you seen that fragment of Crota\'s soul laying around? Uh oh.',
			'Atheon\'s plugged into the power grid again. We\'re experiencing intermittent outages.'
		];

		return responses[Math.floor(Math.random() * responses.length)];
	}

	/**
	 * Get a random response to reply when nothing was found.
	 * @returns {string}
	 * @private
	 */
	static _getRandomResponseForNoResults() {
		const responses = [
			'Are you sure that\'s how it\'s spelled?',
			'Does it look like a Gjallarhorn?',
			'Sorry, I\'ve got nothing.'
		];

		return responses[Math.floor(Math.random() * responses.length)];
	}

	/**
	 * Search for an item that matches the name provided.
	 * @param itemName
	 * @returns {*|promise}
	 */
	async _queryItem(itemName) {
		const world = new World2();

		try {
			const worldDatabasePath = await this.ghost.getWorldDatabasePath();

			await world.open(worldDatabasePath);
			const items = await world.getItemByName(itemName.replace(/[\u2018\u2019]/g, '\''));
			world.close();

			if (items.length > 0) {
				if (items.length > 1) {
					const groups = _.groupBy(items, item => item.itemName);
					const keys = Object.keys(groups);

					if (keys.length === 1) {
						return await this._getItem(items[0]);
					}

					return items;
				}

				return await this._getItem(items[0]);
			}

			return [];
		} catch (err) {
			world.close();
			throw err;
		}
	}

	/**
	 *
	 * @param req
	 * @param res
	 */
	fallback(req, res) {
		const header = req.headers['x-twilio-signature'];
		const twiml = new MessagingResponse();

		if (twilio.validateRequest(authToken, header, process.env.DOMAIN + req.originalUrl, req.body)) {
			twiml.message(attributes, TwilioController._getRandomResponseForAnError());
			res.writeHead(200, {
				'Content-Type': 'text/xml'
			});
		} else {
			res.writeHead(403, {
				'Content-Type': 'text/xml'
			});
		}

		res.end(twiml.toString());
	}

	/**
	 *
	 * @param req
	 * @param res
	 */
	async request(req, res) {
		const header = req.headers['x-twilio-signature'];
		const twiml = new MessagingResponse();

		try {
			if (twilio.validateRequest(authToken, header, process.env.DOMAIN + req.originalUrl, req.body)) {
				let counter = parseInt(req.cookies.counter, 10) || 0;

				const user = await this.users.getUserByPhoneNumber(req.body.From);
				if (!user || !user.dateRegistered) {
					if (!req.cookies.isRegistered) {
						twiml.message(`Register your phone at ${process.env.WEBSITE}/register`);
						res.writeHead(200, {
							'Content-Type': 'text/xml'
						});
						res.end(twiml.toString());
					} else {
						res.writeHead(403);
						res.end();
					}

					return;
				}
				res.cookie('isRegistered', true);
				this.users.addUserMessage(user.displayName, user.membershipType, req.body);

				const itemHash = req.cookies.itemHash;
				const message = req.body.Body.trim().toLowerCase();

				/**
				 * @ToDo Handle STOP and HELP
				 */
				if (new S(message).startsWith('more')) {
					if (itemHash) {
						return bitly.getShortUrl('http://db.destinytracker.com/d2/en/items/' + itemHash)
							.then(function (shortURL) {
								twiml.message(attributes, 'Destiny Tracker\n' + shortURL);
								res.writeHead(200, {
									'Content-Type': 'text/xml'
								});
								res.end(twiml.toString());
							});
					}

					twiml.message(attributes, 'More what?');
					res.writeHead(200, {
						'Content-Type': 'text/xml'
					});
					res.end(twiml.toString());
				} else if (new S(message).equalsIgnoreCase('xur')) {
					try {
						const { bungie: { access_token: accessToken }, membershipId, membershipType } = await this.authentication.authenticate(user);
						const characters = await this.destiny.getProfile(membershipId, membershipType);

						if (characters && characters.length) {
							const itemHashes = await this.destiny.getXur(membershipId, membershipType, characters[0].characterId, accessToken);
							const worldDatabasePath = await this.ghost.getWorldDatabasePath();
							const world = new World2();

							await world.open(worldDatabasePath);
							const items = await Promise.all(itemHashes.map(itemHash => world.getItemByHash(itemHash)));
							world.close();

							const result = _.reduce(items, (memo, { displayProperties }) =>
								(memo + displayProperties.name + '\n'), ' ').trim();

							twiml.message(attributes, result.substr(0, 130));
							res.clearCookie('itemHash');
							res.writeHead(200, {
								'Content-Type': 'text/xml'
							});

							return res.end(twiml.toString());
						}
					} catch (err) {
						log.error(err);
					}
				} else {
					if (counter > 25) {
						twiml.message(attributes, 'Let me check with the Speaker regarding your good standing with the Vanguard.');
						res.writeHead(429, {
							'Content-Type': 'text/xml'
						});
						res.end(twiml.toString());
					} else {
						const searchTerm = req.body.Body.trim().toLowerCase();
						const items = await this._queryItem(searchTerm);

						counter = counter + 1;
						res.cookie('counter', counter);
						switch (items.length) {
							case 0: {
								twiml.message(attributes, TwilioController._getRandomResponseForNoResults());
								res.writeHead(200, {
									'Content-Type': 'text/xml'
								});

								return res.end(twiml.toString());
							}
							case 1: {
								res.cookie('itemHash', items[0].itemHash);
								items[0].itemCategory = new S(items[0].itemCategory).strip('Weapon')
									.collapseWhitespace().s.trim();

								const template = '{{itemName}} {{itemCategory}}';

								if (user.type === 'landline') {
									twiml.message(attributes, (new S(template).template(items[0]).s).substr(0, 130));
								} else {
									twiml.message(attributes,
										new S(template).template(items[0]).s).media(items[0].icon);
								}
								res.writeHead(200, {
									'Content-Type': 'text/xml'
								});

								return res.end(twiml.toString());
							}
							default: {
								const groups = _.groupBy(items, function (item) {
									return item.itemName;
								});
								const keys = Object.keys(groups);
								const result = _.reduce(keys, (memo, key) => {
									return memo + '\n' + key + ' ' + groups[key][0].itemCategory;
								}, ' ').trim();

								twiml.message(attributes, result.substr(0, 130));
								res.clearCookie('itemHash');
								res.writeHead(200, {
									'Content-Type': 'text/xml'
								});

								return res.end(twiml.toString());
							}
						}
					}
				}
			} else {
				res.writeHead(403);
				res.end();
			}
		} catch (err) {
			log.error(err);
			res.status(500).json(err);
		}
	}

	/**
	 *
	 * @param req
	 * @param res
	 */
	statusCallback(req, res) {
		const header = req.headers['x-twilio-signature'];
		const twiml = new MessagingResponse();

		if (twilio.validateRequest(authToken, header, process.env.DOMAIN + req.originalUrl, req.body)) {
			this.users.getUserByPhoneNumber(req.body.To)
				.then(user => {
					if (user) {
						this.users.addUserMessage(user.displayName, user.membershipType, req.body);
					}
				});
			log.info(JSON.stringify(req.body));
			res.writeHead(200, {
				'Content-Type': 'text/xml'
			});
		} else {
			res.writeHead(403, {
				'Content-Type': 'text/xml'
			});
		}

		res.end(twiml.toString());
	}
}

module.exports = TwilioController;
