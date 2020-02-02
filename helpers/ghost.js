const { EventEmitter } = require('events');
const fs = require('fs');
const path = require('path');
const request = require('request');
const yauzl = require('yauzl');
const log = require('./log');

/**
 * Ghost Class
 */
class Ghost extends EventEmitter {
    /**
     * @constructor
     * @param options
     * @todo Need to organize Destiny and Destiny2 databases into separate directories.
     */
    constructor() {
        const [databaseFileName] = fs.readdirSync(process.env.DATABASE)
            .map(name => ({
                name,
                time: fs.statSync(process.env.DATABASE + name).mtime.getTime(),
            }))
            .sort((a, b) => b.time - a.time)
            .map(file => file.name);

        super();
        this.databaseFileName = databaseFileName;
    }

    /**
     * Get the full path to the database.
     *
     * @returns {Promise}
     */
    getWorldDatabasePath() {
        return Promise.resolve(this.databaseFileName
            ? path.join(process.env.DATABASE, path.basename(this.databaseFileName)) : undefined);
    }

    /**
     * Download and unzip the manifest database.
     *
     * @param manifest
     * @returns {*}
     */
    updateManifest(manifest) { // eslint-disable-line class-methods-use-this
        const databasePath = process.env.DATABASE;
        const { mobileWorldContentPaths: { en: relativeUrl } } = manifest;
        const fileName = databasePath + relativeUrl.substring(relativeUrl.lastIndexOf('/') + 1);

        if (fs.existsSync(fileName)) {
            return Promise.resolve(manifest);
        }

        return new Promise((resolve, reject) => {
            const file = fs.createWriteStream(`${fileName}.zip`);
            const stream = request(`https://www.bungie.net${relativeUrl}`, () => {
                log.info(`content downloaded from ${relativeUrl}`);
            }).pipe(file);

            stream.on('finish', () => {
                yauzl.open(`${fileName}.zip`, (err1, zipFile) => { // eslint-disable-line consistent-return
                    if (err1) {
                        return reject(err1);
                    }

                    zipFile.on('entry', entry => {
                        zipFile.openReadStream(entry, (err2, readStream) => {
                            if (err2) {
                                return reject(err2);
                            }

                            readStream.pipe(fs.createWriteStream(databasePath + entry.fileName));
                            fs.unlink(`${fileName}.zip`);

                            return resolve(manifest);
                        });
                    });
                });
            });
        });
    }
}

module.exports = Ghost;
