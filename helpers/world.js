// @ts-check
/**
 * A module for accessing the Destiny World database.
 */
import { readdirSync, statSync, existsSync, createWriteStream, unlinkSync } from 'node:fs';
import { basename, join } from 'node:path';
import { pipeline } from 'node:stream/promises';
import { setTimeout } from 'node:timers/promises';
// @types/node does not yet declare Node's zlib zip API (this Node version supports it).
// @ts-expect-error
import { ZipFile } from 'node:zlib';
import log from './log.js';
import sanitizeDirectory from './sanitize-directory.js';

/**
 * A row from a manifest SQLite table. This repository issues both
 * `SELECT * ...` (full row, e.g. an id column plus `json`) and
 * `SELECT json ...` (single column) queries; only `json` is ever read, but
 * a `SELECT *` row may carry other columns this type doesn't enumerate.
 * @typedef {{ json: string } & Record<string, unknown>} ManifestRow
 */

/**
 * The subset of tinypool's `Pool` used by this repository. Structural so
 * tests can substitute a stub.
 * @typedef {Object} ManifestPool
 * @property {(data: { databasePath: string, queries: string[] }) => Promise<ManifestRow[][]>} run
 */

/**
 * A Destiny Grimoire Card, as defined by DestinyGrimoireCardDefinition.
 * Bungie returns many more fields; only the ones this app reads are modeled.
 * @typedef {Object} GrimoireCardDefinition
 * @property {number} cardId
 * @property {string} cardName
 */

/**
 * A Destiny Vendor, as defined by DestinyVendorDefinition.
 * @typedef {Object} VendorDefinition
 * @property {number} hash
 * @property {{ vendorIcon?: string }} [summary]
 */

/**
 * World Repository
 */
class World {
    /**
     * Resolves once a world has loaded and stays resolved through later
     * reloads, which build their tables before replacing the loaded ones, so
     * queries keep reading the current world while a new one loads.
     * @type {PromiseWithResolvers<void>}
     */
    #loaded = Promise.withResolvers();
    #isLoaded = false;

    /**
     * @param {{ directory?: string, pool?: ManifestPool }} [options]
     */
    constructor({ directory, pool } = {}) {
        /**
         * The most recent load, which resolves without loading anything when
         * no manifest is on disk yet.
         * @type {Promise<void> | null}
         */
        this.bootstrapped = null;
        this.pool = pool;

        if (directory) {
            sanitizeDirectory(directory);

            const [databaseFileName] = readdirSync(directory)
                .map(name => ({
                    name,
                    time: statSync(`${directory}/${name}`).mtime.getTime(),
                }))
                .sort((a, b) => b.time - a.time)
                .map(file => file.name);

            this.directory = directory;
            this.bootstrapped = databaseFileName ? this.load(databaseFileName) : Promise.resolve();
        }
    }

    /**
     * Load a manifest database, and mark the world ready once it has.
     *
     * @protected
     * @param {string} fileName
     * @returns {Promise<void>}
     */
    load(fileName) {
        this.bootstrapped = this.bootstrap(fileName).then(() => {
            this.#isLoaded = true;
            this.#loaded.resolve();
        });

        return this.bootstrapped;
    }

    /**
     * Wait for a world to have loaded. A fresh instance downloads its first
     * manifest at startup, which takes minutes, so this rejects after
     * `timeout` instead of holding a request (or a Twilio webhook) open.
     *
     * @param {number} [timeout] milliseconds
     * @returns {Promise<void>}
     */
    async ready(timeout = 5000) {
        if (this.#isLoaded) {
            return;
        }

        await Promise.race([
            this.#loaded.promise,
            setTimeout(timeout, undefined, { ref: false }).then(() => {
                throw new Error('The Destiny manifest is still loading');
            }),
        ]);
    }

    /**
     * @protected
     * @param {string} [fileName]
     * @returns {Promise<void>}
     */
    async bootstrap(fileName) {
        const directory = /** @type {string} */ (this.directory);
        const databasePath = fileName ? join(directory, basename(fileName)) : undefined;

        if (!databasePath) {
            return;
        }

        log.info(`Loading the first world from ${databasePath}`);

        try {
            const pool = /** @type {ManifestPool} */ (this.pool);
            const [grimoireCards, vendorDefinitions] = await pool.run({
                databasePath,
                queries: [
                    'SELECT * FROM DestinyGrimoireCardDefinition',
                    'SELECT * FROM DestinyVendorDefinition',
                ],
            });

            /** @type {VendorDefinition[]} */
            const vendors = vendorDefinitions.map(({ json: vendor }) => JSON.parse(vendor));

            /** @type {GrimoireCardDefinition[]} */
            this.grimoireCards = grimoireCards.map(({ json: grimoireCard }) =>
                JSON.parse(grimoireCard),
            );
            /** @type {Map<number, VendorDefinition>} */
            this.vendorHashMap = new Map(vendors.map(vendor => [vendor.hash, vendor]));
        } catch (err) {
            log.error({ err }, 'Error loading the first world');

            throw err;
        }
    }

    /**
     * Get a random number of cards.
     *
     * @param {number} numberOfCards
     * @returns {Promise<GrimoireCardDefinition[]>}
     */
    async getGrimoireCards(numberOfCards) {
        if (typeof numberOfCards !== 'number' || !Number.isFinite(numberOfCards)) {
            throw new Error('numberOfCards must be a number');
        }

        numberOfCards = Math.trunc(numberOfCards);

        if (numberOfCards <= 0) {
            return [];
        }

        await this.ready();

        const cards = [...this.grimoireCards];

        for (let i = cards.length - 1; i > cards.length - 1 - numberOfCards && i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));

            [cards[i], cards[j]] = [cards[j], cards[i]];
        }

        return cards.slice(-numberOfCards);
    }

    /**
     * Get a random vendor icon.
     *
     * @param {number} vendorHash
     * @returns {Promise<string | undefined>}
     */
    async getVendorIcon(vendorHash) {
        await this.ready();

        const vendor = this.vendorHashMap.get(vendorHash);
        const icon = vendor?.summary?.vendorIcon;

        return icon ? `https://www.bungie.net${icon}` : undefined;
    }

    /**
     * Download and unzip the manifest database.
     *
     * @param {import('../destiny/destiny.cache.js').DestinyManifest} manifest
     * @returns {Promise<import('../destiny/destiny.cache.js').DestinyManifest>}
     */
    async updateManifest(manifest) {
        const databaseDirectory = /** @type {string} */ (this.directory);
        const { mobileWorldContentPaths: { en: relativeUrl } = {} } = manifest;
        const fileName = basename(relativeUrl || '');

        if (!fileName || fileName === '.' || fileName === '..') {
            throw new Error(`Invalid manifest path: ${relativeUrl}`);
        }

        const databasePath = join(databaseDirectory, fileName);

        if (existsSync(databasePath)) {
            return Promise.resolve(manifest);
        }

        // Runs from finally blocks and catch handlers, so it must never throw —
        // a failure here would mask the error that actually aborted the update.
        const cleanupFile = (/** @type {string} */ path) => {
            try {
                if (existsSync(path)) {
                    unlinkSync(path);
                }
            } catch (err) {
                log.warn({ err, path }, 'Failed to remove the temporary archive');
            }
        };

        const downloadFile = async (/** @type {string} */ url, /** @type {string} */ path) => {
            try {
                const response = await fetch(url);

                if (!response.ok || !response.body) {
                    throw new Error(`Download failed with status ${response.status}`);
                }

                const file = createWriteStream(path);

                await pipeline(response.body, file);
            } catch (err) {
                cleanupFile(path);
                throw err;
            }
        };

        const unzipFile = async (
            /** @type {string} */ zipPath,
            /** @type {string} */ outputPath,
        ) => {
            let zipFile;

            try {
                zipFile = await ZipFile.open(zipPath);

                // Directory and symlink entries are both excluded by isFile.
                for (const [, entry] of zipFile.entriesSync()) {
                    if (!entry.isFile) {
                        continue;
                    }

                    const fileName = basename(entry.name);

                    // basename() strips traversal, but still returns '.' or '..' for
                    // names like `nested/..`, which resolve to a directory and would
                    // fail the whole update with EISDIR.
                    if (fileName === '' || fileName === '.' || fileName === '..') {
                        log.warn({ entry: entry.name }, 'Skipping unsafe archive entry');

                        continue;
                    }

                    await pipeline(
                        await zipFile.stream(entry.name),
                        createWriteStream(join(outputPath, fileName)),
                    );
                }
            } finally {
                try {
                    await zipFile?.close();
                } catch (err) {
                    // A failed close must not skip the cleanup below, nor replace
                    // the error that actually aborted the extraction.
                    log.warn({ err }, 'Failed to close the manifest archive');
                }

                cleanupFile(zipPath);
            }
        };

        try {
            await downloadFile(`https://www.bungie.net${relativeUrl}`, `${databasePath}.zip`);
            log.info(`Content downloaded from ${relativeUrl}`);

            await unzipFile(`${databasePath}.zip`, databaseDirectory);
            await this.load(fileName);

            return manifest;
        } catch (err) {
            log.error({ err }, 'Error updating manifest');

            throw err;
        }
    }
}

export default World;
