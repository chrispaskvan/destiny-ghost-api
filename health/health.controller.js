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
            this.store.del(key, (err, res) => {
                if (err) {
                    reject(err);
                } else {
                    resolve(res === 1);
                }
            });
        });
    }

    async _getDestinyManifestVersion() {
        const { version } = await this.destinyService.getManifest();

        return version;
    }

    async _getDestiny2ManifestVersion() {
        const { version } = await this.destiny2Service.getManifest();

        return version;
    }

    async _getDocumentCount() {
        const documents = await this.documents.getDocuments('Users',
            'SELECT VALUE COUNT(1) FROM Users', {
                enableCrossPartitionQuery: true,
            });

        return documents[0];
    }

    _setKey(key, value) {
        return new Promise((resolve, reject) => {
            this.store.set(key, value, (err, res) => {
                if (err) {
                    reject(err);
                } else {
                    resolve(res === 'OK');
                }
            });
        });
    }

    async _isStoreHealthy() {
        const key = 'Dredgen Yorn';
        const value = 'Thorn';

        const success = await this._setKey(key, value); // eslint-disable-line no-underscore-dangle

        if (success) {
            if (await this._validateKey(key, value)) { // eslint-disable-line no-underscore-dangle
                return this._deleteKey(key); // eslint-disable-line no-underscore-dangle
            }
        }

        return false;
    }

    static async _twilio() {
        const options = {
            url: 'https://gpkpyklzq55q.statuspage.io/api/v2/status.json',
        };
        const responseBody = await get(options);

        return responseBody.status.description;
    }

    static _unhealthy() {
        failures += 1;
    }

    _validateKey(key, value) {
        return new Promise((resolve, reject) => {
            this.store.get(key, (err, res) => {
                if (err) {
                    reject(err);
                } else {
                    resolve(res === value);
                }
            });
        });
    }

    async _getWorldItem() {
        const [{ itemDescription } = {}] = await this.world.getItemByName('Doctrine of Passing');

        return itemDescription;
    }

    async _getWorld2Item() {
        const [{ displayProperties: { description = notAvailable } = {} } = {}] = await this.world2.getItemByName('Polaris Lance');

        return description;
    }

    async getHealth(req, res) {
        /* eslint-disable no-underscore-dangle, max-len */
        failures = 0;

        const documents = await this._getDocumentCount()
            .catch(err => HealthController._unhealthy(err)) || -1;
        const manifestVersion = await this._getDestinyManifestVersion()
            .catch(err => HealthController._unhealthy(err)) || notAvailable;
        const manifest2Version = await this._getDestiny2ManifestVersion()
            .catch(err => HealthController._unhealthy(err)) || notAvailable;
        const store = await this._isStoreHealthy()
            .catch(err => HealthController._unhealthy(err)) || false;
        const twilio = await HealthController._twilio()
            .catch(err => HealthController._unhealthy(err)) || notAvailable;
        const world = await this._getWorldItem()
            .catch(err => HealthController._unhealthy(err)) || notAvailable;
        const world2 = await this._getWorld2Item()
            .catch(err => HealthController._unhealthy(err)) || notAvailable;

        res.status(failures ? 503 : 200).json({
            documents,
            store,
            twilio,
            destiny: {
                manifest: manifestVersion,
                world,
            },
            destiny2: {
                manifest: manifest2Version,
                world: world2,
            },
        });
    }
}

module.exports = HealthController;
