/**
 * A module for accessing the Destiny World database.
 *
 * @module World
 * @summary Destiny World database.
 * @author Chris Paskvan
 * @requires _
 * @requires fs
 * @requires Q
 * @requires S
 * @requires sqlite3
 */
const path = require('path');
const Database = require('better-sqlite3');
const World = require('./world');

/**
 * World2 Repository
 */
class World2 extends World {
    constructor(options = {}) {
        super(options);

        this.bootstrap(this.database);
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
            const damageTypes = database.prepare('SELECT json FROM DestinyDamageTypeDefinition').all();
            const items = database.prepare('SELECT json FROM DestinyInventoryItemDefinition').all();
            const loreDefinitions = database.prepare('SELECT json FROM DestinyLoreDefinition').all();
            const vendors = database.prepare('SELECT json FROM DestinyVendorDefinition').all();

            database.close();

            this.categories = categories.map(({ json: category }) => JSON.parse(category));
            this.classes = classes.map(({ json: classDefinition }) => JSON.parse(classDefinition));
            this.damageTypes = damageTypes.map(({ json: damageType }) => JSON.parse(damageType));
            this.items = items.map(({ json: item }) => JSON.parse(item));
            this.loreDefinitions = loreDefinitions.map(({ json: lore }) => JSON.parse(lore));
            this.vendors = vendors.map(({ json: vendor }) => JSON.parse(vendor));
        }
    }

    /**
     * Get the class according to the provided hash.
     * @param classHash {string}
     */
    getClassByHash(classHash) {
        return Promise.resolve(this.classes
            .find(characterClass => characterClass.hash === classHash));
    }

    /**
     * Get the damage type according to the provided hash.
     * @param classHash {string}
     */
    getDamageTypeByHash(damageTypeHash) {
        return Promise.resolve(this.damageTypes
            .find(damageType => damageType.hash === damageTypeHash));
    }

    /**
     * Get item by the hash provided.
     * @param itemHash
     * @returns {*}
     */
    getItemByHash(itemHash) {
        return new Promise((resolve, reject) => {
            try {
                const item = this.items.find(item1 => item1.hash === itemHash);

                resolve(item);
            } catch (err) {
                reject(err);
            }
        });
    }

    /**
     * Look up the item(s) with matching strings in their name(s).
     * @param itemName {string}
     * @returns {Promise}
     */
    async getItemByName(itemName) {
        const items = this.items.filter(({ displayProperties: { name } = '' }) => name.toLowerCase().includes(itemName.toLowerCase()));

        return Promise.resolve(items.map(item => Object.assign(item, {
            itemCategory: item.itemTypeAndTierDisplayName,
            itemName: item.displayProperties.name,
        })));
    }

    /**
     * Get the category definition for the provided hash.
     * @param itemCategoryHash
     * @returns {Promise}
     */
    getItemCategory(itemCategoryHash) {
        return Promise.resolve(this.categories
            .find(category => category.hash === itemCategoryHash));
    }

    /**
     * Get the lore by item hash.
     * @param hash
     * @returns {Promise}
     */
    getLore(hash) {
        return Promise.resolve(this.loreDefinitions.find(lore => lore.hash === hash));
    }

    /**
     * Get vendor's icon.
     * @param vendorHash
     * @returns {Promise}
     */
    getVendorIcon(vendorHash) {
        return new Promise((resolve, reject) => {
            try {
                const [vendor] = this.vendors.filter(vendor1 => vendor1.hash === vendorHash);

                resolve(`https://www.bungie.net${vendor.displayProperties.icon}`);
            } catch (err) {
                reject(err);
            }
        });
    }
}

module.exports = World2;
