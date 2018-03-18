/**
 * A module for handling Destiny 2 routes.
 *
 * @module destinyController
 * @author Chris Paskvan
 */
const DestinyController = require('../destiny/destiny.controller'),
    fs = require('fs'),
    log = require('../helpers/log'),
    request = require('request'),
    yauzl = require('yauzl');

/**
 * Destiny Controller Service
 */
class Destiny2Controller extends DestinyController {
    constructor(options = {}) {
        super(options);
    }

	/**
	 * Leaderboard
	 * @param req
	 * @param res
	 */
	getLeaderboard(req, res) {
		const { session: { displayName, membershipType }} = req;

		this.users.getUserByDisplayName(displayName, membershipType)
			.then(currentUser => {
				const { bungie: { access_token: accessToken }} = currentUser;

				return this.destiny.getLeaderboard(currentUser.membershipId, membershipType, accessToken)
					.then(leaderboard => {
						res.status(200).json(leaderboard).end();
					});
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
	 * Get characters for the current user.
	 * @returns {*|Array}
	 * @private
	 */
	getProfile(req, res) {
		const { session: { displayName, membershipType }} = req;

		this.ghost.getWorldDatabasePath()
			.then(worldDatabasePath => this.world.open(worldDatabasePath))
			.then(() => this.users.getUserByDisplayName(displayName, membershipType))
			.then(currentUser => this.destiny.getProfile(currentUser.membershipId, membershipType))
			.then(characters => {
				let promises = [];
				let characterBases = characters.map(character => {
					promises.push(this.world.getClassByHash(character.classHash));

					return {
						characterId: character.characterId,
						classHash: character.classHash,
						emblem: character.emblemPath,
						backgroundPath: character.emblemBackgroundPath,
						powerLevel: character.light,
						links: [
							{
								rel: 'Character',
								href: '/characters/' + character.characterId
							}
						]
					}
				});

				return Promise.all(promises)
					.then(characterClasses => {
						characterBases.forEach((characterBase, index) => {
							characterBase.className = characterClasses[index].displayProperties.name;
						});
						res.status(200).json(characterBases);
					});
			})
			.catch(err => {
				log.error(err);
				this.world.close();
				res.status(500).json(err);
			});
	}

	/**
	 * Get Xur's inventory.
	 * @returns {*|Array}
	 * @private
	 */
	async getXur(req, res) {
		const { session: { displayName, membershipType }} = req;

		try {
			const currentUser = await this.users.getUserByDisplayName(displayName, membershipType);
			const { bungie: { access_token: accessToken }, membershipId } = currentUser;

			const characters = await this.destiny.getProfile(membershipId, membershipType);
			if (characters && characters.length) {
				const itemHashes = await this.destiny.getXur(membershipId, membershipType, characters[0].characterId, accessToken);
				if (!itemHashes.length) {
					return res.status(200).json(itemHashes);
				}

				const worldDatabasePath = await this.ghost.getWorldDatabasePath();
				await this.world.open(worldDatabasePath);
				const items = await Promise.all(itemHashes.map(itemHash => this.world.getItemByHash(itemHash)));
				await this.world.close();

				return res.status(200).json(items);
			}

			res.status(404);
		} catch (err) {
			log.error(err);
			res.status(500).json(err);
			await this.worldRepository.close();
		}
	}

	/**
	 *
	 * @param req
	 * @param res
	 */
	upsertManifest(req, res) {
        this.destiny.getManifest()
            .then(manifest => {
                return this.destiny.getManifest(true)
                    .then(latestManifest => {
                        const databasePath = process.env.DATABASE;
                        const { mobileWorldContentPaths: { en: relativeUrl }}  = latestManifest;
                        const fileName = databasePath + relativeUrl.substring(relativeUrl.lastIndexOf('/') + 1);

                        if (!latestManifest || latestManifest.version !== manifest.version ||
                                latestManifest.mobileWorldContentPaths.en !== manifest.mobileWorldContentPaths.en ||
                                !fs.existsSync(fileName)) {
                            const file = fs.createWriteStream(fileName + '.zip');
                            const stream = request('https://www.bungie.net' + relativeUrl, () => {
                                log.info('content downloaded from ' + relativeUrl);
                            }).pipe(file);

                            stream.on('finish', () => {
                                yauzl.open(fileName + '.zip', (err, zipFile) => {
                                    if (!err) {
                                        zipFile.on('entry', entry => {
                                            zipFile.openReadStream(entry, (err, readStream) => {
                                                if (!err) {
                                                    readStream.pipe(fs.createWriteStream(databasePath + entry.fileName));

                                                    fs.unlink(fileName + '.zip', () => {});

                                                    res.status(204).end();
                                                } else {
                                                    throw err;
                                                }
                                            });
                                        });
                                    } else {
                                        throw err;
                                    }
                                });
                            });
                        } else {
                            res.status(304).end();
                        }
                    });
            })
            .catch(err => {
                log.error(err);
                res.status(500).json(err);
            });
    }
}

module.exports = Destiny2Controller;
