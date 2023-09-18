/* eslint-disable security/detect-non-literal-fs-filename */
/**
 * A module for accessing the Destiny World database.
 */
import {
    readdirSync, statSync, existsSync, createWriteStream, unlinkSync,
} from 'fs';
import { join, basename } from 'path';
import sampleSize from 'lodash/sampleSize';
import Database from 'better-sqlite3';
import axios from 'axios';
import { open } from 'yauzl';
import log from './log';

/**
 * World Repository
 */
class World {
    constructor({ directory } = {}) {
        this.grimoireCards = [];
        this.vendors = [];

        if (directory) {
            const [databaseFileName] = readdirSync(directory)
                .map(name => ({
                    name,
                    time: statSync(`${directory}/${name}`).mtime.getTime(),
                }))
                .sort((a, b) => b.time - a.time)
                .map(file => file.name);

            this.directory = directory;
            this.bootstrap(databaseFileName);
        }
    }

    /**
     * @private
     */
    bootstrap(fileName) {
        const databasePath = fileName
            ? join(this.directory, basename(fileName)) : undefined;

        if (databasePath) {
            const database = new Database(databasePath, {
                readonly: true,
                fileMustExist: true,
            });

            const grimoireCards = database.prepare('SELECT * FROM DestinyGrimoireCardDefinition').all();
            const vendors = database.prepare('SELECT * FROM DestinyVendorDefinition').all();

            database.close();

            this.grimoireCards = grimoireCards
                .map(({ json: grimoireCard }) => JSON.parse(grimoireCard));
            this.vendors = vendors
                .map(({ json: vendor }) => JSON.parse(vendor));
        }
    }

    /**
     * Get a random number of cards.
     *
     * @param numberOfCards {integer}
     * @returns {Promise}
     */
    getGrimoireCards(numberOfCards) {
        return Promise.resolve(sampleSize(this.grimoireCards, numberOfCards));
    }

    /**
     * Get a random vendor icon.
     *
     * @param vendorHash {string}
     * @returns {Promise<string>}
     */
    getVendorIcon(vendorHash) {
        const vendor1 = this.vendors.find(vendor => vendor?.summary?.vendorHash === vendorHash);
        const icon = vendor1?.summary?.vendorIcon;

        return icon ? Promise.resolve(`https://www.bungie.net${icon}`) : Promise.resolve(undefined);
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

        return new Promise((resolve, reject) => {
            const file = createWriteStream(`${databasePath}.zip`);

            axios.get(`https://www.bungie.net${relativeUrl}`, {
                responseType: 'stream',
            }).then(({ data: stream }) => {
                stream.on('data', chunk => {
                    // eslint-disable-next-line new-cap
                    file.write(new Buffer.from(chunk));
                });
                stream.on('end', () => {
                    log.info(`content downloaded from ${relativeUrl}`);

                    open(`${databasePath}.zip`, (err, zipFile) => {
                        if (err) {
                            return reject(err);
                        }

                        return zipFile.on('entry', entry => {
                            zipFile.openReadStream(entry, (err1, readStream) => {
                                if (err) {
                                    return reject(err);
                                }

                                readStream.on('end', () => {
                                    this.bootstrap(fileName);
                                });
                                readStream.pipe(createWriteStream(`${databaseDirectory}/${entry.fileName}`));
                                unlinkSync(`${databasePath}.zip`);

                                return resolve(manifest);
                            });
                        });
                    });
                });
            });
        });
    }
}

export default World;
