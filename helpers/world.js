/**
 * A module for accessing the Destiny World database.
 */
const _ = require('underscore');
const Database = require('better-sqlite3');
const fs = require('fs');
const path = require('path');
const request = require('request');
const yauzl = require('yauzl');
const log = require('./log');

/**
 * World Repository
 */
class World {
    constructor({ directory } = {}) {
        this.grimoireCards = [];

        if (directory) {
            const [databaseFileName] = fs.readdirSync(directory)
                .map(name => ({
                    name,
                    time: fs.statSync(`${directory}/${name}`).mtime.getTime(),
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
            ? path.join(this.directory, path.basename(fileName)) : undefined;

        if (databasePath) {
            const database = new Database(databasePath, {
                readonly: true,
                fileMustExist: true,
            });

            const grimoireCards = database.prepare('SELECT * FROM DestinyGrimoireCardDefinition').all();

            database.close();

            this.grimoireCards = grimoireCards.map(({ json: grimoireCard }) => JSON.parse(grimoireCard)); // eslint-disable-line max-len
        }
    }

    /**
     * Get a Random Number of Cards
     * @param numberOfCards {integer}
     * @returns {Promise}
     */
    getGrimoireCards(numberOfCards) {
        return Promise.resolve(_.sample(this.grimoireCards, numberOfCards));
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

        if (fs.existsSync(databasePath)) {
            return Promise.resolve(manifest);
        }

        return new Promise((resolve, reject) => {
            const file = fs.createWriteStream(`${databasePath}.zip`);
            const stream = request(`https://www.bungie.net${relativeUrl}`, () => {
                log.info(`content downloaded from ${relativeUrl}`);
            }).pipe(file);

            stream.on('finish', () => {
                yauzl.open(`${databasePath}.zip`, (err, zipFile) => {
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
                            readStream.pipe(fs.createWriteStream(`${databaseDirectory}/${entry.fileName}`));
                            fs.unlinkSync(`${databasePath}.zip`);

                            return resolve(manifest);
                        });
                    });
                });
            });
        });
    }
}

module.exports = World;
