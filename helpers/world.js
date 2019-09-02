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
        this.categories = [];
        this.classes = [];
        this.items = [];
        this.grimoireCards = [];
        this.vendors = [];

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

            const categories = database.prepare('SELECT json FROM DestinyItemCategoryDefinition').all();
            const classes = database.prepare('SELECT json FROM DestinyClassDefinition').all();
            const grimoireCards = database.prepare('SELECT * FROM DestinyGrimoireCardDefinition').all();
            const items = database.prepare('SELECT json FROM DestinyInventoryItemDefinition').all();
            const vendors = database.prepare('SELECT json FROM DestinyVendorDefinition').all();

            database.close();

            this.categories = categories.map(({ json: category }) => JSON.parse(category));
            this.classes = classes.map(({ json: classDefinition }) => JSON.parse(classDefinition));
            this.grimoireCards = grimoireCards.map(({ json: grimoireCard }) => JSON.parse(grimoireCard)); // eslint-disable-line max-len
            this.items = items.map(({ json: item }) => JSON.parse(item));
            this.vendors = vendors.map(({ json: vendor }) => JSON.parse(vendor));
        }
    }

    /**
     * Get the class according to the provided hash.
     * @param classHash {string}
     */
    getClassByHash(classHash) {
        return Promise.resolve(this.classes.find(characterClass => characterClass.classHash === classHash)); // eslint-disable-line max-len
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
     * Look up the item(s) with matching strings in their name(s).
     * @param itemName {string}
     * @returns {Promise}
     */
    getItemByName(itemName) {
        return new Promise((resolve, reject) => {
            try {
                const items = this.items.filter(({ itemName: name = '' }) => name.toLowerCase().includes(itemName.toLowerCase()));

                const groups = _.groupBy(items, item => item.itemName);
                const keys = Object.keys(groups);

                resolve(_.map(keys, key => _.min(_.filter(items, item => item.itemName === key),
                    item => item.qualityLevel)));
            } catch (err) {
                reject(err);
            }
        });
    }

    /**
     * Get item by the hash provided.
     * @param itemHash
     * @returns {*}
     */
    getItemByHash(itemHash) {
        return new Promise((resolve, reject) => {
            try {
                const [item] = this.items.filter(item1 => item1.itemHash === itemHash);

                resolve(item);
            } catch (err) {
                reject(err);
            }
        });
    }

    /**
     * Get the category definition for the provided hash.
     * @param itemCategoryHash
     * @returns {Promise}
     */
    getItemCategory(itemCategoryHash) {
        return Promise.resolve(this.categories.find(category => category.id === itemCategoryHash));
    }

    /**
     * Get vendor's icon.
     * @param vendorHash
     * @returns {Promise}
     */
    getVendorIcon(vendorHash) {
        return new Promise((resolve, reject) => {
            try {
                const [vendor] = this.vendors.filter(vendor1 => vendor1.vendorHash === vendorHash);

                resolve(`https://www.bungie.net${vendor.summary.vendorIcon}`);
            } catch (err) {
                reject(err);
            }
        });
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
