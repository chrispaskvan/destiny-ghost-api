// @ts-check
/**
 * A module for reporting the health status of dependent services.
 *
 * @module healthController
 * @author Chris Paskvan
 */
import { getHeapStatistics } from 'v8';
import { convert } from 'html-to-text';

import { get } from '../helpers/request.js';
import { getCircuitBreakerStatus } from '../helpers/bungie.request.js';
import applicationInsights from '../helpers/application-insights.js';
import log from '../helpers/log.js';

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

/** @typedef {import('../destiny/destiny.service.js').default} DestinyService */
/** @typedef {import('../destiny2/destiny2.service.js').default} Destiny2Service */
/** @typedef {import('../helpers/documents.js').default} Documents */
/** @typedef {import('../helpers/world.js').default} World */
/** @typedef {import('../helpers/world2.js').default} World2 */

/**
 * Only `getMemoryUsage`/`getMetrics` are exercised without a full set of
 * dependencies (see health.controller.spec.js), so every property here is
 * optional to allow that construction; every other method assumes its
 * dependency is present, matching how the routes always construct this
 * class in production.
 * @typedef {Object} HealthControllerOptions
 * @property {DestinyService} [destinyService]
 * @property {Destiny2Service} [destiny2Service]
 * @property {Documents} [documents]
 * @property {World} [worldRepository]
 * @property {World2} [world2Repository]
 */

/**
 * Destiny Controller Service
 */
class HealthController {
    /**
     * @param {HealthControllerOptions} [options]
     */
    constructor(options = {}) {
        this.destinyService = /** @type {DestinyService} */ (options.destinyService);
        this.destiny2Service = /** @type {Destiny2Service} */ (options.destiny2Service);
        this.documents = /** @type {Documents} */ (options.documents);
        this.world = /** @type {World} */ (options.worldRepository);
        this.world2 = /** @type {World2} */ (options.world2Repository);
    }

    async getDestinyManifestVersion() {
        const {
            data: { manifest },
        } = await this.destinyService.getManifest();

        return manifest?.version;
    }

    async getDestiny2ManifestVersion() {
        const {
            data: { manifest },
        } = await this.destiny2Service.getManifest();

        return manifest?.version;
    }

    /**
     * @returns {Promise<number>}
     */
    async getDocumentCount() {
        const documents = await this.documents.getDocuments(
            'Users',
            'SELECT VALUE COUNT(1) FROM Users',
        );

        return /** @type {number[]} */ (documents)[0];
    }

    /**
     * {@link https://www.valentinog.com/blog/node-usage/|Guide: How To Inspect Memory Usage in Node.js}
     * {@link https://deepu.tech/memory-management-in-v8/|Visualizing memory management in V8 Engine (JavaScript, NodeJS, Deno, WebAssembly)}
     *
     * @static
     * @returns {{ rss: number, heapTotal: number, heapUsed: number, external: number, totalAvailableSize: number }}
     * @memberof HealthController
     */
    static getMemoryUsage() {
        /** @param {number} bytes */
        const convertBytesToMegaBytes = bytes => Math.floor(bytes / (1024 * 1024));
        const { rss, heapTotal, heapUsed, external } = process.memoryUsage();
        const { total_available_size: totalAvailableSize } = getHeapStatistics();

        return {
            rss: convertBytesToMegaBytes(rss),
            heapTotal: convertBytesToMegaBytes(heapTotal),
            heapUsed: convertBytesToMegaBytes(heapUsed),
            external: convertBytesToMegaBytes(external),
            totalAvailableSize: convertBytesToMegaBytes(totalAvailableSize),
        };
    }

    async getMetrics() {
        const memory = /** @type {typeof HealthController} */ (this.constructor).getMemoryUsage();

        applicationInsights.trackMetric({
            name: 'Ratio of RSS Memory to Total Available Size',
            value: Math.round(memory.rss / memory.totalAvailableSize),
        });

        log.info(
            {
                memory,
            },
            'Memory Statistics',
        );

        return { memory };
    }

    static async twilio() {
        const options = {
            url: 'https://status.twilio.com/api/v2/status.json',
        };
        const responseBody = await get(options);

        return responseBody.status.description;
    }

    /**
     * @param {Error} err
     */
    static unhealthy(err) {
        failures += 1;
        log.error(
            {
                message: err.message,
            },
            'Health Check failure occurred.',
        );
    }

    async getWorldItem() {
        const [{ cardName = '' } = {}] = await this.world.getGrimoireCards(1);

        return convert(cardName);
    }

    async getWorld2Item() {
        const [{ itemName = notAvailable, itemTypeAndTierDisplayName } = {}] =
            await this.world2.getItemByName('The Martlet');

        return `${itemName} ${itemTypeAndTierDisplayName}`;
    }

    async getHealth() {
        failures = 0;

        const documents =
            (await this.getDocumentCount().catch(err => HealthController.unhealthy(err))) || -1;
        const manifestVersion =
            (await this.getDestinyManifestVersion().catch(err =>
                HealthController.unhealthy(err),
            )) || notAvailable;
        const manifest2Version =
            (await this.getDestiny2ManifestVersion().catch(err =>
                HealthController.unhealthy(err),
            )) || notAvailable;
        const twilio =
            (await HealthController.twilio().catch(err => HealthController.unhealthy(err))) ||
            notAvailable;
        const world =
            (await this.getWorldItem().catch(err => HealthController.unhealthy(err))) ||
            notAvailable;
        const world2 =
            (await this.getWorld2Item().catch(err => HealthController.unhealthy(err))) ||
            notAvailable;

        return {
            failures,
            health: {
                // Reported for observability only: an open breaker means
                // Bungie is down, not this service, so it never counts as
                // a failure.
                bungie: getCircuitBreakerStatus(),
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
