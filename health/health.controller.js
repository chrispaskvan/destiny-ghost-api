/**
 * A module for reporting the health status of dependent services.
 *
 * @module healthController
 * @author Chris Paskvan
 */
const { get } = require('../helpers/request');

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
		this.store = options.store;
		this.world = options.worldRepository;
		this.world2 = options.world2Repository;
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

	static async _twilio() {
		const options = {
			url: 'https://gpkpyklzq55q.statuspage.io/api/v2/status.json'
		};
		const responseBody = await get(options);

		return responseBody.status.description;
	}

	static _unhealthy() {
		failures++;
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
		const [{ itemDescription } = {}] =
			await this.world.getItemByName('Doctrine of Passing');

		return itemDescription;
	}

	async _world2() {
		const [{ displayProperties: { description = notAvailable } = {}} = {}] =
			await this.world2.getItemByName('Polaris Lance');

		return description;
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
		const twilio = await HealthController._twilio()
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
