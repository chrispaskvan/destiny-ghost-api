// @ts-check
/**
 * A module for reporting the health status of dependent services.
 *
 * @module healthController
 * @author Chris Paskvan
 */
import { readFileSync } from 'node:fs';
import { totalmem } from 'node:os';
import { getHeapStatistics } from 'node:v8';
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
 * Only `getSwap`/`getMemoryUsage`/`getMetrics` are exercised without a full set of
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
     * The process's swapped-out memory, which `rss` does not include, read
     * from `/proc/self/status`. Undefined where that file is unavailable
     * (macOS) or unreadable (production must grant it to the permission
     * model).
     *
     * @static
     * @returns {number | undefined} bytes
     * @memberof HealthController
     */
    static getSwap() {
        try {
            const [, kilobytes] =
                readFileSync('/proc/self/status', 'utf8').match(/^VmSwap:\s+(\d+) kB$/m) ?? [];

            return kilobytes === undefined ? undefined : Number(kilobytes) * 1024;
        } catch {
            return undefined;
        }
    }

    /**
     * Reports usage against the two limits that can end the process: the V8
     * heap limit ("heap out of memory") and the memory available to it, the
     * smaller of the container limit and physical RAM. The process's footprint
     * is `rss` plus `swap`, since swapped pages are still memory it holds.
     *
     * {@link https://www.valentinog.com/blog/node-usage/|Guide: How To Inspect Memory Usage in Node.js}
     * {@link https://deepu.tech/memory-management-in-v8/|Visualizing memory management in V8 Engine (JavaScript, NodeJS, Deno, WebAssembly)}
     *
     * @static
     * @memberof HealthController
     */
    static getMemoryUsage() {
        /** @param {number} bytes */
        const convertBytesToMegaBytes = bytes => Math.floor(bytes / (1024 * 1024));
        /**
         * @param {number} used
         * @param {number} limit
         */
        const percentageOf = (used, limit) => Math.round((used / limit) * 100);
        const { rss, heapTotal, heapUsed, external } = process.memoryUsage();
        const { heap_size_limit: heapSizeLimit } = getHeapStatistics();
        const swap = HealthController.getSwap();
        const totalMemory = totalmem();
        const constrainedMemory = process.constrainedMemory();
        // 0 when no limit is detected, and 2^64 (cgroup's "max") on App Service,
        // so only a limit below physical memory is a real one
        const containerMemoryLimit =
            constrainedMemory > 0 && constrainedMemory < totalMemory
                ? constrainedMemory
                : undefined;
        const memoryLimit = containerMemoryLimit ?? totalMemory;

        return {
            rss: convertBytesToMegaBytes(rss),
            swap: swap === undefined ? undefined : convertBytesToMegaBytes(swap),
            heapTotal: convertBytesToMegaBytes(heapTotal),
            heapUsed: convertBytesToMegaBytes(heapUsed),
            external: convertBytesToMegaBytes(external),
            heapSizeLimit: convertBytesToMegaBytes(heapSizeLimit),
            percentageOfHeapLimit: percentageOf(heapUsed, heapSizeLimit),
            containerMemoryLimit:
                containerMemoryLimit === undefined
                    ? undefined
                    : convertBytesToMegaBytes(containerMemoryLimit),
            totalMemory: convertBytesToMegaBytes(totalMemory),
            memoryLimit: convertBytesToMegaBytes(memoryLimit),
            percentageOfMemoryLimit: percentageOf(rss + (swap ?? 0), memoryLimit),
        };
    }

    async getMetrics() {
        const memory = /** @type {typeof HealthController} */ (this.constructor).getMemoryUsage();

        applicationInsights.trackMetric({
            name: 'Percentage of Memory Limit',
            value: memory.percentageOfMemoryLimit,
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
