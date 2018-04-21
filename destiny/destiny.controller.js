const _ = require('underscore'),
	base64url = require('base64url'),
	crypto = require('crypto'),
	log = require('../helpers/log');

/**
 * Controller class for Destiny routes.
 */
class DestinyController {
	/**
	 * @constructor
	 * @param options
	 */
	constructor(options = {}) {
		this.destiny = options.destinyService;
		this.users = options.userService;
		this.world = options.worldRepository;
	}

	/**
	 * Get a random state.
	 * @returns {*}
	 * @private
	 */
	static _getRandomState() {
		return base64url(crypto.randomBytes(11));
	}

	/**
	 * Get the authorization URL for Bungie application.
	 * @param req
	 * @param res
	 */
	getAuthorizationUrl(req, res) {
		const state = this.constructor._getRandomState();

		req.session.state = state;

		this.destiny.getAuthorizationUrl(state)
			.then(url => res.send(url))
			.catch(err => {
				log.error(err);
				res.status(500).json(err);
			});
	}

	/**
	 * Get characters for the current user.
	 * @returns {*|Array}
	 * @private
	 */
	getCharacters(req, res) {
		const { session: { displayName, membershipType }} = req;

		this.users.getUserByDisplayName(displayName, membershipType)
			.then(currentUser => this.destiny.getCharacters(currentUser.membershipId, membershipType))
			.then(characters => {
				const characterBases = characters.map(character =>  {
					return {
						characterId: character.characterBase.characterId,
						classHash: character.characterBase.classHash,
						emblem: character.emblemPath,
						backgroundPath: character.backgroundPath,
						powerLevel: character.characterBase.powerLevel,
						links: [
							{
								rel: 'Character',
								href: '/characters/' + character.characterBase.characterId
							}
						]
					};
				});

				let promises = [];
				characterBases.forEach(characterBase =>
					promises.push(this.world.getClassByHash(characterBase.classHash)));

				return Promise.all(promises)
					.then(characterClasses => {
						characterBases.forEach((characterBase, index) => {
							characterBase.className = characterClasses[index].className;
						});

						res.json(characterBases);
					});
			})
			.catch(err => {
				log.error(err);
				res.status(500).json(err);
			});
	}

	/**
	 * Get the currently available field test weapons from the gun smith.
	 * @param req
	 * @param res
	 */
	getFieldTestWeapons(req, res) {
		const { session: { displayName, membershipType }} = req;
		let accessToken;

		this.users.getUserByDisplayName(displayName, membershipType)
			.then(currentUser => {
				accessToken = currentUser.bungie.access_token;

				return this.destiny.getCharacters(currentUser.membershipId, membershipType);
			})
			.then(characters => {
				if (characters && characters.length > 0) {
					const { characterBase: { characterId }} = characters[0];

					return this.destiny.getFieldTestWeapons(characterId, accessToken)
						.then(vendor => {
							const { itemHashes } = vendor;
							let promises = [];

							itemHashes.forEach(itemHash => promises.push(this.world.getItemByHash(itemHash)));
							return Promise.all(promises)
								.then(items => {
									res.json(items.map(item => item.itemName));
								});
						});
				}

				return res.status(411).end();
			})
			.catch(err => {
				log.error(err);
				res.status(500).json(err);
			});
	}

	/**
	 * Get the currently available field test weapons from the gun smith.
	 * @param req
	 * @param res
	 */
	getFoundryOrders(req, res) {
		const { session: { displayName, membershipType }} = req;
		let accessToken;

		this.users.getUserByDisplayName(displayName, membershipType)
			.then(currentUser => {
				accessToken = currentUser.bungie.access_token;

				return this.destiny.getCharacters(currentUser.membershipId, membershipType);
			})
			.then(characters => {
				if (characters && characters.length > 0) {
					const { characterBase: { characterId }} = characters[0];

					return this.destiny.getFoundryOrders(characterId, accessToken)
						.then(vendor => {
							const { itemHashes } = vendor;
							let promises = [];

							itemHashes.forEach(itemHash => promises.push(this.world.getItemByHash(itemHash)));
							return Promise.all(promises)
								.then(items => {
									res.json(items.map(item => item.itemName));
								});
						});
				}

				return res.status(411).end();
			})
			.catch(err => {
				log.error(err);
				res.status(500).json(err);
			});
	}

	/**
	 * Get the currently available field test weapons from the gun smith.
	 * @param req
	 * @param res
	 */
	getIronBannerEventRewards(req, res) {
		const { session: { displayName, membershipType }} = req;
		let accessToken;

		this.users.getUserByDisplayName(displayName, membershipType)
			.then(currentUser => {
				accessToken = currentUser.bungie.access_token;

				return this.destiny.getCharacters(currentUser.membershipId, membershipType);
			})
			.then(characters => {
				let characterPromises = [];

				_.each(characters, character => {
					characterPromises.push(
						this.destiny.getIronBannerEventRewards(character.characterBase.characterId, accessToken)
					);
				});

				return Promise.all(characterPromises)
					.then(characterItems => {
						const items = _.flatten(characterItems);
						const itemHashes = _.uniq(_.map(items, function (item) {
							return item.item.itemHash;
						}));

						let promises = [];

						_.each(itemHashes, function (itemHash) {
							promises.push(this.world.getItemByHash(itemHash));
						});

						return Promise.all(promises)
							.then(function (items) {
								const weapons = _.filter(items, item => _.contains(item.itemCategoryHashes, 1));
								const hunterArmor = _.filter(items, item => _.contains(item.itemCategoryHashes, 20) &&
									_.contains(item.itemCategoryHashes, 23));
								const titanArmor = _.filter(items, item => _.contains(item.itemCategoryHashes, 20) &&
									_.contains(item.itemCategoryHashes, 22));
								const warlockArmor = _.filter(items, item => _.contains(item.itemCategoryHashes, 20) &&
										_.contains(item.itemCategoryHashes, 21));

								res.json({
									weapons: _.map(weapons,item => item.itemName),
									armor: {
										hunter: _.map(hunterArmor, item => item.itemName),
										titan: _.map(titanArmor, item => item.itemName),
										warlock: _.map(warlockArmor, item => item.itemName)
									}
								});
							});
					});
			})
			.catch(err => {
				log.error(err);
				res.status(500).json(err);
			});
	}

	/**
	 * Get a Random Selection of Grimoire Cards
	 * @param req
	 * @param res
	 * @returns {*}
	 */
	getGrimoireCards(req, res) {
		const numberOfCards = parseInt(req.params.numberOfCards, 10);

		if (isNaN(numberOfCards)) {
			return res.status(422).end();
		}

		this.world.getGrimoireCards(numberOfCards)
			.then(grimoireCards => {
				res.status(200).json(grimoireCards)
			})
			.catch(err => {
				log.error(err);
				res.status(500).json(err);
			});
	}

	/**
	 * Get the current manifest definition from Bungie.
	 * @param req
	 * @param res
	 */
	getManifest(req, res) {
		this.destiny.getManifest()
			.then(manifest => {
				res.status(200).json(manifest).end();
			});
	}

	/**
	 * Get the exotic weapons and gear available from Xur.
	 * @param req
	 * @param res
	 */
	getXur(req, res) {
		return this.destiny.getXur()
			.then(vendor => {
				const { itemHashes, nextRefreshDate } = vendor;

				if (itemHashes === undefined || itemHashes.length === 0) {
					return res.status(200).json({ itemHashes: [], nextRefreshDate: nextRefreshDate });
				}

				let promises = [];

				itemHashes.forEach(itemHash => promises.push(this.world.getItemByHash(itemHash)));

				return Promise.all(promises)
					.then(items => {
						const itemPromises = _.map(items, item => {
							if (item.itemName === 'Exotic Engram' ||
									item.itemName === 'Legacy Engram') {
								return this.world.getItemByHash(item.itemHash)
									.then(function (itemDetail) {
										return item.itemName.replace('Engram', '') +
											itemDetail.itemTypeName;
									});
							}

							return Promise.resolve(item.itemName);
						});

						return Promise.all(itemPromises)
							.then(items => {
								res.json(items);
							});
					});
			})
			.catch(err => {
				log.error(err);
				res.status(500).json(err);
			});
	}

	/**
	 * Insert or update the Destiny manifest.
	 */
	upsertManifest(req, res) {
		return this.destiny.getManifest(true)
			.then(manifest => {
				this.world.updateManifest(manifest)
					.then(() => {
						res.status(200).json(manifest);
					});
			})
			.catch(err => {
				log.error(err);
				res.status(500).json(err);
			});
	}
}

module.exports = DestinyController;
