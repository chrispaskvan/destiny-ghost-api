/**
 * A module for reporting the health status of dependent services.
 *
 * @module healthController
 * @author Chris Paskvan
 */
import { getHeapStatistics } from 'v8';

import { get } from '../helpers/request';
import applicationInsights from '../helpers/application-insights';
import log from '../helpers/log';

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
        this.world = options.worldRepository;
        this.world2 = options.world2Repository;
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
        const documents = await this.documents.getDocuments(
            'Users',
            'SELECT VALUE COUNT(1) FROM Users',
            {
                enableCrossPartitionQuery: true,
            },
        );

        return documents[0];
    }

    /**
     * {@link https://www.valentinog.com/blog/node-usage/|Guide: How To Inspect Memory Usage in Node.js}
     * {@link https://deepu.tech/memory-management-in-v8/|Visualizing memory management in V8 Engine (JavaScript, NodeJS, Deno, WebAssembly)}
     *
     * @static
     * @returns
     * @memberof HealthController
     */
    static getMemoryUsage() {
        const convertBytesToMegaBytes = bytes => Math.floor(bytes / (1024 * 1024));
        const {
            rss,
            heapTotal,
            heapUsed,
            external,
        } = process.memoryUsage();
        const { total_available_size: totalAvailableSize } = getHeapStatistics();

        return {
            rss: convertBytesToMegaBytes(rss),
            heapTotal: convertBytesToMegaBytes(heapTotal),
            heapUsed: convertBytesToMegaBytes(heapUsed),
            external: convertBytesToMegaBytes(external),
            totalAvailableSize: convertBytesToMegaBytes(totalAvailableSize),
        };
    }

    static async twilio() {
        const options = {
            url: 'https://status.twilio.com/api/v2/status.json',
        };
        const responseBody = await get(options);

        return responseBody.status.description;
    }

    static unhealthy() {
        failures += 1;
    }

    async getWorldItem() {
        const [{ cardName } = {}] = await this.world.getGrimoireCards(1);

        return cardName;
    }

    async getWorld2Item() {
        const [
            {
                itemName = notAvailable,
                itemTypeAndTierDisplayName,
            } = {},
        ] = await this.world2.getItemByName('Malfeasance');

        return `${itemName} ${itemTypeAndTierDisplayName}`;
    }

    async getHealth() {
        failures = 0;

        const documents = await this.getDocumentCount()
            .catch(err => HealthController.unhealthy(err)) || -1;
        const manifestVersion = await this.getDestinyManifestVersion()
            .catch(err => HealthController.unhealthy(err)) || notAvailable;
        const manifest2Version = await this.getDestiny2ManifestVersion()
            .catch(err => HealthController.unhealthy(err)) || notAvailable;
        const twilio = await HealthController.twilio()
            .catch(err => HealthController.unhealthy(err)) || notAvailable;
        const world = await this.getWorldItem()
            .catch(err => HealthController.unhealthy(err)) || notAvailable;
        const world2 = await this.getWorld2Item()
            .catch(err => HealthController.unhealthy(err)) || notAvailable;
        const memory = this.constructor.getMemoryUsage();

        applicationInsights.trackMetric({
            name: 'Percent of Available Memory Used',
            value: Math.round((memory.rss / memory.totalAvailableSize) * 100),
        });
        log.info({
            memory,
        }, 'Memory Statistics');

        return {
            failures,
            health: {
                documents,
                twilio,
                destiny: {
                    manifest: manifestVersion,
                    world,
                },
                destiny2: {
                    manifest: manifest2Version,
                    world: world2,
                },
            },
        };
    }
}

export default HealthController;
