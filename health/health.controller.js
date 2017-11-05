/**
 * A module for handling Destiny 2 routes.
 *
 * @module destinyController
 * @author Chris Paskvan
 */
const Ghost = require('../ghost/ghost'),
	log = require('../helpers/log'),
	request = require('request');

/**
 * Not available
 * @type {string}
 */
const notAvailable = 'N/A';

/**
 * Destiny Controller Service
 */
class HealthController {
	constructor(options) {
		this.destinyService = options.destinyService;
		this.documents = options.documents;
		this.ghost = new Ghost({
			destinyService: options.destinyService
		});
		this.store = options.store;
		this.worldRepository = options.worldRepository;
	}

	_deleteKey(key) {
		return new Promise((resolve, reject) => {
			this.store.del(key, function (err, res) {
				if (err) {
					reject(err);
				} else {
					resolve(res === 1);
				}
			});
		});
	}

	async _destinyService() {
		const manifest = await this.destinyService.getManifest();

		return manifest.version;
	}

	async _documents() {
		const documents = await this.documents.getDocuments('Users',
			'SELECT VALUE COUNT(1) FROM Users', {
				enableCrossPartitionQuery: true
			});

		return documents[0];
	}

	_setKey(key, value) {
		return new Promise((resolve, reject) => {
			this.store.set(key, value, function (err, res) {
				if (err) {
					reject(err);
				} else {
					resolve(res === 'OK');
				}
			});
		})
	}

	async _store() {
		const key = 'Dredgen Yorn';
		const value = 'Thorn';

		return await this._setKey(key, value) ? await this._validateKey(key, value)  ? await this._deleteKey(key)
			: false : false;
	}

	async _twilio() {
		const opts = {
			url: 'https://gpkpyklzq55q.statuspage.io/api/v2/status.json'
		};

		return new Promise((resolve, reject) => {
			request.get(opts, (err, res, body) => {
				if (err) {
					reject(err);
				}

				if (res.statusCode !== 200) {
					reject(res.statusCode);
				}

				const responseBody = JSON.parse(body);

				resolve(responseBody.status.description);
			});
		});
	}

	_validateKey(key, value) {
		return new Promise((resolve, reject) => {
			this.store.get(key, function (err, res) {
				if (err) {
					reject(err);
				} else {
					resolve(res === value);
				}
			});
		});
	}

	async _world () {
		try {
			const worldDatabasePath = await this.ghost.getWorldDatabasePath();
			await this.worldRepository.open(worldDatabasePath);

			const [{ displayProperties: { description = notAvailable }}] = await this.worldRepository.getItemByName('Better Devils');
			await this.worldRepository.close();

			return description;
		} catch (err) {
			this.worldRepository.close();
			throw err;
		}
	}

	async getHealth(req, res) {
		const documents = await this._documents()
			.catch(err => log.error(err)) || -1;
		const manifestVersion = await this._destinyService()
			.catch(err => log.error(err)) || notAvailable;
		const store = await this._store()
			.catch(err => log.error(err)) || false;
		const twilio = await this._twilio()
			.catch(err => log.error(err)) || notAvailable;
		const world = await this._world()
			.catch(err => log.error(err)) || notAvailable;

		res.status(200).json({
			documents,
			store,
			manifest: manifestVersion,
			twilio,
			world
		});
	}
}

module.exports = HealthController;
