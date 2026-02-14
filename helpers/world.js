/**
 * A module for accessing the Destiny World database.
 */
import {
    readdirSync, statSync, existsSync, createWriteStream, unlinkSync,
} from 'node:fs';
import { basename, join } from 'node:path';
import { pipeline } from 'node:stream/promises';
import sampleSize from 'lodash/sampleSize.js';
import { open } from 'yauzl';
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
        const databasePath = fileName
            ? join(this.directory, basename(fileName)) : undefined;

        log.info(`Loading the first world from ${databasePath}`);

        if (databasePath) {
            try {
                const [grimoireCards, vendorDefinitions] = await this.pool.run({ databasePath, queries: [
                    'SELECT * FROM DestinyGrimoireCardDefinition',
                    'SELECT * FROM DestinyVendorDefinition'
                ]});

                const vendors = vendorDefinitions.map(({ json: vendor }) => JSON.parse(vendor));

                this.grimoireCards = grimoireCards.map(({ json: grimoireCard }) => JSON.parse(grimoireCard));
                this.vendorHashMap = new Map(vendors.map(vendor => [vendor.hash, vendor]));
            }
            catch (err) {
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
        if (typeof numberOfCards !== 'number') {
            throw new Error('numberOfCards must be a number');
        }

        await this.bootstrapped;

        return sampleSize(this.grimoireCards, numberOfCards);
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
    updateManifest(manifest) {
        const { directory: databaseDirectory } = this;
        const { mobileWorldContentPaths: { en: relativeUrl } } = manifest;
        const fileName = relativeUrl.substring(relativeUrl.lastIndexOf('/') + 1);
        const databasePath = `${databaseDirectory}/${fileName}`;

        if (existsSync(databasePath)) {
            return Promise.resolve(manifest);
        }

        const cleanupFile = path => {
            if (existsSync(path)) {
                unlinkSync(path);
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
            }
            catch (err) {
                cleanupFile(path);
                throw err;
            }
        };

        const unzipFile = (zipPath, outputPath) => {
            return new Promise((resolve, reject) => {
                open(zipPath, { lazyEntries: true }, (err, zipFile) => {
                    if (err) {
                        cleanupFile(zipPath);
                        return reject(err);
                    }

                    zipFile.readEntry();

                    zipFile.on('entry', entry => {
                        zipFile.openReadStream(entry, (err, readStream) => {
                            if (err) {
                                cleanupFile(zipPath);
                                return reject(err);
                            }

                            const sanitizedFileName = basename(entry.fileName);
                            const writeStream = createWriteStream(`${outputPath}/${sanitizedFileName}`);

                            readStream.pipe(writeStream);

                            writeStream.on('finish', () => {
                                zipFile.readEntry();
                            });

                            writeStream.on('error', err => {
                                cleanupFile(zipPath);
                                reject(err);
                            });
                        });
                    });

                    zipFile.on('end', () => {
                        cleanupFile(zipPath);
                        resolve();
                    });
                });
            });
        };

        return downloadFile(`https://www.bungie.net${relativeUrl}`, `${databasePath}.zip`)
            .then(() => {
                log.info(`Content downloaded from ${relativeUrl}`);

                return unzipFile(`${databasePath}.zip`, databaseDirectory);
            })
            .then(() => {
                this.bootstrap(fileName);

                return manifest;
            })
            .catch(err => {
                log.error('Error updating manifest:', err);

                throw err;
            });
    }
}

export default World;
