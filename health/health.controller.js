/**
 * A module for reporting the health status of dependent services.
 *
 * @module healthController
 * @author Chris Paskvan
 */
const Ghost = require('../helpers/ghost'),
	log = require('../helpers/log'),
	request = require('request');

/**
 * Not available
 * @type {string}
 */
const notAvailable = 'N/A';

/**
 * Number of failing services
 * @type {number}
 */
let failures;

/**
 * Destiny Controller Service
 */
class HealthController {
	constructor(options = {}) {
		this.destinyService = options.destinyService;
		this.destiny2Service = options.destiny2Service;
		this.documents = options.documents;
		this.ghost = new Ghost({
			destinyService: options.destinyService
		});
		this.ghost2 = new Ghost({
			destinyService: options.destiny2Service
		});
		this.store = options.store;
		this.worldRepository = options.worldRepository;
		this.world2Repository = options.world2Repository;
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

	async _destiny2Service() {
		const manifest = await this.destiny2Service.getManifest();

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

	static _unhealthy(err) {
		failures++;
		log.error(err);
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

	async _world() {
		try {
			const worldDatabasePath = await this.ghost.getWorldDatabasePath();
			await this.worldRepository.open(worldDatabasePath);

			const [item] =
				await this.worldRepository.getItemByName('Aegis of the Reef');
			await this.worldRepository.close();

			return item.itemDescription;
		} catch (err) {
			this.worldRepository.close();
			throw err;
		}
	}

	async _world2() {
		try {
			const worldDatabasePath = await this.ghost2.getWorldDatabasePath();
			await this.world2Repository.open(worldDatabasePath);

			const [{ displayProperties: { description = notAvailable }}] =
				await this.world2Repository.getItemByName('Jack Queen King 3');
			await this.world2Repository.close();

			return description;
		} catch (err) {
			this.world2Repository.close();
			throw err;
		}
	}

	async getHealth(req, res) {
		failures = 0;

		const documents = await this._documents()
			.catch(err => HealthController._unhealthy(err)) || -1;
		const manifestVersion = await this._destinyService()
			.catch(err => HealthController._unhealthy(err)) || notAvailable;
		const manifest2Version = await this._destiny2Service()
			.catch(err => HealthController._unhealthy(err)) || notAvailable;
		const store = await this._store()
			.catch(err => HealthController._unhealthy(err)) || false;
		const twilio = await this._twilio()
			.catch(err => HealthController._unhealthy(err)) || notAvailable;
		const world = await this._world()
			.catch(err => HealthController._unhealthy(err)) || notAvailable;
		const world2 = await this._world2()
			.catch(err => HealthController._unhealthy(err)) || notAvailable;

		res.status(failures ? 503 : 200).json({
			documents,
			store,
			twilio,
			destiny: {
				manifest: manifestVersion,
				world: world
			},
			destiny2: {
				manifest: manifest2Version,
				world: world2
			}
		});
	}
}

module.exports = HealthController;
