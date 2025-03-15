/**
 * A module for accessing the Destiny World database.
 *
 * @module World
 * @summary Destiny World database.
 * @requires _
 * @requires fs
 * @requires Q
 * @requires S
 * @requires sqlite3
 */
import { join, basename } from 'path';
import World from './world';
import log from './log';

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
    }

    /**
     * @private
     */
    async bootstrap(fileName) {
        const databasePath = fileName
            ? join(this.directory, basename(fileName)) : undefined;

        log.info(`Loading the second world from ${databasePath}`);

        if (databasePath) {
            const [categoryDefinitions, classDefinitions, damageTypeDefinitions, itemDefinitions, loreDefinitions, vendorDefinitions] = await this.pool.run({ databasePath, queries: [
                'SELECT json FROM DestinyItemCategoryDefinition',
                'SELECT json FROM DestinyClassDefinition',
                'SELECT json FROM DestinyDamageTypeDefinition',
                'SELECT json FROM DestinyInventoryItemDefinition',
                'SELECT json FROM DestinyLoreDefinition',
                'SELECT json FROM DestinyVendorDefinition'
            ]});

            const classes = classDefinitions.map(({ json: classDefinition }) => JSON.parse(classDefinition));
            const damageTypes = damageTypeDefinitions.map(({ json: damageType }) => JSON.parse(damageType));
            const lores = loreDefinitions.map(({ json: lore }) => JSON.parse(lore));
            const vendors = vendorDefinitions.map(({ json: vendor }) => JSON.parse(vendor));

            this.categories = categoryDefinitions.map(({ json: category }) => JSON.parse(category));
            this.categoryHashMap = new Map(this.categories.map(category => [category.hash, category]));
            this.classHashMap = new Map(classes.map(characterClass => [characterClass.hash, characterClass]));
            this.damageTypeHashMap = new Map(damageTypes.map(damageType => [damageType.hash, damageType]));
            this.items = itemDefinitions.map(({ json: item }) => JSON.parse(item));
            this.itemHashMap = new Map(this.items.map(item => [item.hash, item]));
            this.loreDefinitionHashMap = new Map(lores.map(lore => [lore.hash, lore]));
            this.vendorHashMap = new Map(vendors.map(vendor => [vendor.hash, vendor]));
        }
    }

    get weaponCategory() {
        this.#weaponCategory ||= this.categories.find(category => category?.displayProperties?.name === 'Weapon').hash;

        return this.#weaponCategory;
    }

    /**
     * Get the class according to the provided hash.
     * @param classHash {string}
     */
    getClassByHash(classHash) {
        return this.classHashMap.get(classHash);
    }

    /**
     * Get the damage type according to the provided hash.
     * @param classHash {string}
     */
    getDamageTypeByHash(damageTypeHash) {
        return this.damageTypeHashMap.get(damageTypeHash);
    }

    /**
     * Get item by the hash provided.
     * @param itemHash
     * @returns {*}
     */
    getItemByHash(itemHash) {
        return this.itemHashMap.get(itemHash);
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
        return this.categoryHashMap.get(itemCategoryHash);
    }

    /**
     * Get the lore by item hash.
     * @param hash
     * @returns {Promise}
     */
    getLore(hash) {
        return this.loreDefinitionHashMap.get(hash);
    }

    /**
     * Get vendor's icon.
     * @param vendorHash
     * @returns {Promise}
     */
    getVendorIcon(vendorHash) {
        const vendor = this.vendorHashMap.get(vendorHash);
        const icon = vendor?.displayProperties?.icon;

        return icon ? Promise.resolve(`https://www.bungie.net${icon}`) : Promise.resolve(undefined);
    }
}

export default World2;
