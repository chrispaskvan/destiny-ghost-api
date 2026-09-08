// @ts-check
/**
 * A module for accessing the Destiny World database.
 *
 * @module World
 * @summary Destiny World database.
 */
import { join, basename } from 'node:path';
import World from './world.js';
import log from './log.js';

/**
 * A Destiny 2 definition record's common shape — nearly every manifest
 * table shares `hash` plus a localized `displayProperties.name`.
 * @typedef {Object} DefinitionRecord
 * @property {number} hash
 * @property {{ name?: string, icon?: string }} [displayProperties]
 */

/** @typedef {DefinitionRecord} CategoryDefinition */
/** @typedef {DefinitionRecord} ClassDefinition */
/** @typedef {DefinitionRecord} DamageTypeDefinition */
/** @typedef {DefinitionRecord} LoreDefinition */
/** @typedef {DefinitionRecord} VendorDefinition */

/**
 * A Destiny 2 inventory item, as defined by DestinyInventoryItemDefinition.
 * Bungie returns many more fields; only the ones this app reads are modeled.
 * @typedef {Object} ItemDefinition
 * @property {number} hash
 * @property {{ name?: string }} [displayProperties]
 * @property {string} [flavorText]
 * @property {string} [itemTypeAndTierDisplayName]
 * @property {number} [itemType]
 * @property {string} [itemTypeDisplayName]
 * @property {number} [defaultDamageTypeHash]
 * @property {{ tierTypeName?: string }} [inventory]
 * @property {number[]} [itemCategoryHashes]
 */

/**
 * World2 Repository
 */
class World2 extends World {
    /**
     * Weapon Category
     * @type {number | undefined}
     */
    #weaponCategory;

    /**
     * @param {{ directory?: string, pool?: import('./world.js').ManifestPool }} [options]
     */
    constructor(options = {}) {
        super(options);
    }

    /**
     * @protected
     * @param {string} [fileName]
     * @returns {Promise<void>}
     */
    async bootstrap(fileName) {
        const directory = /** @type {string} */ (this.directory);
        const databasePath = fileName ? join(directory, basename(fileName)) : undefined;

        log.info(`Loading the second world from ${databasePath}`);

        if (databasePath) {
            try {
                const pool = /** @type {import('./world.js').ManifestPool} */ (this.pool);
                const [
                    categoryDefinitions,
                    classDefinitions,
                    damageTypeDefinitions,
                    itemDefinitions,
                    loreDefinitions,
                    vendorDefinitions,
                ] = await pool.run({
                    databasePath,
                    queries: [
                        'SELECT json FROM DestinyItemCategoryDefinition',
                        'SELECT json FROM DestinyClassDefinition',
                        'SELECT json FROM DestinyDamageTypeDefinition',
                        'SELECT json FROM DestinyInventoryItemDefinition',
                        'SELECT json FROM DestinyLoreDefinition',
                        'SELECT json FROM DestinyVendorDefinition',
                    ],
                });

                /** @type {ClassDefinition[]} */
                const classes = classDefinitions.map(({ json: classDefinition }) =>
                    JSON.parse(classDefinition),
                );
                /** @type {DamageTypeDefinition[]} */
                const damageTypes = damageTypeDefinitions.map(({ json: damageType }) =>
                    JSON.parse(damageType),
                );
                /** @type {LoreDefinition[]} */
                const lores = loreDefinitions.map(({ json: lore }) => JSON.parse(lore));
                /** @type {VendorDefinition[]} */
                const vendors = vendorDefinitions.map(({ json: vendor }) => JSON.parse(vendor));

                /** @type {CategoryDefinition[]} */
                this.categories = categoryDefinitions.map(({ json: category }) =>
                    JSON.parse(category),
                );
                /** @type {Map<number, CategoryDefinition>} */
                this.categoryHashMap = new Map(
                    this.categories.map(category => [category.hash, category]),
                );
                /** @type {Map<number, ClassDefinition>} */
                this.classHashMap = new Map(
                    classes.map(characterClass => [characterClass.hash, characterClass]),
                );
                /** @type {Map<number, DamageTypeDefinition>} */
                this.damageTypeHashMap = new Map(
                    damageTypes.map(damageType => [damageType.hash, damageType]),
                );
                /** @type {ItemDefinition[]} */
                this.items = itemDefinitions.map(({ json: item }) => JSON.parse(item));
                /** @type {Map<number, ItemDefinition>} */
                this.itemHashMap = new Map(this.items.map(item => [item.hash, item]));
                /** @type {Map<number, LoreDefinition>} */
                this.loreDefinitionHashMap = new Map(lores.map(lore => [lore.hash, lore]));
                /** @type {Map<number, VendorDefinition>} */
                this.vendorHashMap = new Map(vendors.map(vendor => [vendor.hash, vendor]));
            } catch (err) {
                log.error(
                    `Error loading the second world: ${err instanceof Error ? err.message : String(err)}`,
                );
                throw err;
            }
        }
    }

    /**
     * @returns {Promise<number>}
     */
    async getWeaponCategory() {
        await this.bootstrapped;

        if (this.#weaponCategory === undefined) {
            const weaponCategory = this.categories.find(
                category => category?.displayProperties?.name === 'Weapon',
            );

            if (!weaponCategory) {
                throw new Error('Weapon category definition not found in manifest');
            }

            this.#weaponCategory = weaponCategory.hash;
        }

        return this.#weaponCategory;
    }

    /**
     * Get the class according to the provided hash.
     * @param {number} classHash
     * @returns {Promise<ClassDefinition | undefined>}
     */
    async getClassByHash(classHash) {
        await this.bootstrapped;

        return this.classHashMap.get(classHash);
    }

    /**
     * Get the damage type according to the provided hash.
     * @param {number} damageTypeHash
     * @returns {Promise<DamageTypeDefinition | undefined>}
     */
    async getDamageTypeByHash(damageTypeHash) {
        await this.bootstrapped;

        return this.damageTypeHashMap.get(damageTypeHash);
    }

    /**
     * Get item by the hash provided.
     * @param {number} itemHash
     * @returns {Promise<ItemDefinition | undefined>}
     */
    async getItemByHash(itemHash) {
        await this.bootstrapped;

        return this.itemHashMap.get(itemHash);
    }

    /**
     * Look up the item(s) with matching strings in their name(s).
     * @param {string} itemName
     * @returns {Promise<ItemDefinition[]>}
     */
    async getItemByName(itemName) {
        await this.bootstrapped;

        const lowerCaseItemName = itemName.trim().toLowerCase();

        if (!lowerCaseItemName) {
            return [];
        }

        const items = this.items.filter(({ displayProperties: { name } = {} }) =>
            (name ?? '').toLowerCase().includes(lowerCaseItemName),
        );

        return items.map(item =>
            Object.assign(item, {
                flavorText: item.flavorText,
                itemCategory: item.itemTypeAndTierDisplayName,
                itemName: item.displayProperties?.name,
            }),
        );
    }

    /**
     * Get the category definition for the provided hash.
     * @param {number} itemCategoryHash
     * @returns {Promise<CategoryDefinition | undefined>}
     */
    async getItemCategory(itemCategoryHash) {
        await this.bootstrapped;

        return this.categoryHashMap.get(itemCategoryHash);
    }

    /**
     * Get the lore by item hash.
     * @param {number} hash
     * @returns {Promise<LoreDefinition | undefined>}
     */
    async getLore(hash) {
        await this.bootstrapped;

        return this.loreDefinitionHashMap.get(hash);
    }

    /**
     * Get vendor's icon.
     * @param {number} vendorHash
     * @returns {Promise<string | undefined>}
     */
    async getVendorIcon(vendorHash) {
        await this.bootstrapped;

        const vendor = this.vendorHashMap.get(vendorHash);
        const icon = vendor?.displayProperties?.icon;

        return icon ? `https://www.bungie.net${icon}` : undefined;
    }
}

export default World2;
