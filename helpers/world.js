/**
 * A module for accessing the Destiny World database.
 */
import { readdirSync, statSync, existsSync, createWriteStream, unlinkSync } from 'node:fs';
import { basename, join } from 'node:path';
import { pipeline } from 'node:stream/promises';
import { ZipFile } from 'node:zlib';
import log from './log.js';
import sanitizeDirectory from './sanitize-directory.js';

/**
 * World Repository
 */
class World {
    constructor({ directory, pool } = {}) {
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
            this.bootstrapped = this.bootstrap(databaseFileName); // Store the bootstrap promise
        }
    }

    /**
     * @private
     */
    async bootstrap(fileName) {
        const databasePath = fileName ? join(this.directory, basename(fileName)) : undefined;

        log.info(`Loading the first world from ${databasePath}`);

        if (databasePath) {
            try {
                const [grimoireCards, vendorDefinitions] = await this.pool.run({
                    databasePath,
                    queries: [
                        'SELECT * FROM DestinyGrimoireCardDefinition',
                        'SELECT * FROM DestinyVendorDefinition',
                    ],
                });

                const vendors = vendorDefinitions.map(({ json: vendor }) => JSON.parse(vendor));

                this.grimoireCards = grimoireCards.map(({ json: grimoireCard }) =>
                    JSON.parse(grimoireCard),
                );
                this.vendorHashMap = new Map(vendors.map(vendor => [vendor.hash, vendor]));
            } catch (err) {
                log.error(`Error loading the first world: ${err.message}`);
                throw err;
            }
        }
    }

    /**
     * Get a random number of cards.
     *
     * @param numberOfCards {integer}
     * @returns {Promise}
     */
    async getGrimoireCards(numberOfCards) {
        if (typeof numberOfCards !== 'number' || !Number.isFinite(numberOfCards)) {
            throw new Error('numberOfCards must be a number');
        }

        numberOfCards = Math.trunc(numberOfCards);

        if (numberOfCards <= 0) {
            return [];
        }

        await this.bootstrapped;

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
     * @param vendorHash {string}
     * @returns {Promise<string>}
     */
    async getVendorIcon(vendorHash) {
        await this.bootstrapped;

        const vendor = this.vendorHashMap.get(vendorHash);
        const icon = vendor?.summary?.vendorIcon;

        return icon ? `https://www.bungie.net${icon}` : undefined;
    }

    /**
     * Download and unzip the manifest database.
     *
     * @param manifest
     * @returns {*}
     */
    async updateManifest(manifest) {
        const { directory: databaseDirectory } = this;
        const {
            mobileWorldContentPaths: { en: relativeUrl },
        } = manifest;
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
        const cleanupFile = path => {
            try {
                if (existsSync(path)) {
                    unlinkSync(path);
                }
            } catch (err) {
                log.warn({ err, path }, 'Failed to remove the temporary archive');
            }
        };

        const downloadFile = async (url, path) => {
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

        const unzipFile = async (zipPath, outputPath) => {
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
            this.bootstrapped = this.bootstrap(fileName);
            await this.bootstrapped;

            return manifest;
        } catch (err) {
            log.error({ err }, 'Error updating manifest');

            throw err;
        }
    }
}

export default World;
