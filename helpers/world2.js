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
import { join, basename } from 'path';
import Database from 'better-sqlite3';
import World from './world';

/**
 * World2 Repository
 */
class World2 extends World {
    /**
     * Weapon Category
     * @private
     */
    #weaponCategory;

    constructor(options = {}) {
        super(options);

        this.bootstrap(this.databasePath);
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
                timeout: 3000,
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

    get weaponCategory() {
        if (!this.#weaponCategory) {
            this.#weaponCategory = this.categories.find(category => category?.displayProperties?.name === 'Weapon').hash;
        }

        return this.#weaponCategory;
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
            flavorText: item.flavorText,
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
        const vendor1 = this.vendors.find(vendor => vendor.hash === vendorHash);
        const icon = vendor1?.displayProperties?.icon;

        return icon ? Promise.resolve(`https://www.bungie.net${icon}`) : Promise.resolve(undefined);
    }
}

export default World2;
