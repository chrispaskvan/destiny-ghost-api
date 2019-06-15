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

    deleteKey(key) {
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

    async getDestinyManifestVersion() {
        const { version } = await this.destinyService.getManifest();

        return version;
    }

    async getDestiny2ManifestVersion() {
        const { version } = await this.destiny2Service.getManifest();

        return version;
    }

    async getDocumentCount() {
        const documents = await this.documents.getDocuments('Users',
            'SELECT VALUE COUNT(1) FROM Users', {
                enableCrossPartitionQuery: true,
            });

        return documents[0];
    }

    setKey(key, value) {
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

    async isStoreHealthy() {
        const key = 'Dredgen Yorn';
        const value = 'Thorn';

        const success = await this.setKey(key, value);

        if (success) {
            if (await this.validateKey(key, value)) {
                return this.deleteKey(key);
            }
        }

        return false;
    }

    static async twilio() {
        const options = {
            url: 'https://gpkpyklzq55q.statuspage.io/api/v2/status.json',
        };
        const responseBody = await get(options);

        return responseBody.status.description;
    }

    static unhealthy() {
        failures += 1;
    }

    validateKey(key, value) {
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

    async getWorldItem() {
        const [{ itemDescription } = {}] = await this.world.getItemByName('Doctrine of Passing');

        return itemDescription;
    }

    async getWorld2Item() {
        const [{ displayProperties: { description = notAvailable } = {} } = {}] = await this.world2.getItemByName('Polaris Lance');

        return description;
    }

    async getHealth(req, res) {
        failures = 0;

        const documents = await this.getDocumentCount()
            .catch(err => HealthController.unhealthy(err)) || -1;
        const manifestVersion = await this.getDestinyManifestVersion()
            .catch(err => HealthController.unhealthy(err)) || notAvailable;
        const manifest2Version = await this.getDestiny2ManifestVersion()
            .catch(err => HealthController.unhealthy(err)) || notAvailable;
        const store = await this.isStoreHealthy()
            .catch(err => HealthController.unhealthy(err)) || false;
        const twilio = await HealthController.twilio()
            .catch(err => HealthController.unhealthy(err)) || notAvailable;
        const world = await this.getWorldItem()
            .catch(err => HealthController.unhealthy(err)) || notAvailable;
        const world2 = await this.getWorld2Item()
            .catch(err => HealthController.unhealthy(err)) || notAvailable;

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
