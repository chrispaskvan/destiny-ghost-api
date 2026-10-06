// @ts-check
/**
 * A module for accessing the Destiny World database.
 *
 * @module World
 * @summary Destiny World database.
 */
import { join, basename } from 'node:path';
import ManifestTable from './manifest-table.js';
import World from './world.js';
import log from './log.js';

/**
 * A Destiny 2 definition record's common shape — nearly every manifest
 * table shares `hash` plus a localized `displayProperties.name`.
 * @typedef {Object} DefinitionRecord
 * @property {number} hash
 * @property {{ name?: string, icon?: string }} [displayProperties]
 */

/**
 * A DestinyItemCategoryDefinition record — a DefinitionRecord plus the
 * short display label twilio.controller.js groups items by.
 * @typedef {DefinitionRecord & { shortTitle?: string }} CategoryDefinition
 */

/** @typedef {DefinitionRecord} ClassDefinition */
/** @typedef {DefinitionRecord} DamageTypeDefinition */
/** @typedef {DefinitionRecord} LoreDefinition */
/** @typedef {DefinitionRecord} VendorDefinition */

/**
 * A Destiny 2 inventory item, as defined by DestinyInventoryItemDefinition.
 * Bungie returns many more fields; only the ones this app reads are modeled.
 * @typedef {Object} ItemDefinition
 * @property {number} hash
 * @property {{ name?: string, icon?: string }} [displayProperties]
 * @property {string} [flavorText]
 * @property {string} [itemTypeAndTierDisplayName]
 * @property {number} [itemType]
 * @property {string} [itemTypeDisplayName]
 * @property {number} [defaultDamageTypeHash]
 * @property {{ tierTypeName?: string }} [inventory]
 * @property {number[]} [itemCategoryHashes]
 * @property {string} [itemCategory] - Added by getItemByName(), aliasing itemTypeAndTierDisplayName
 * @property {string} [itemName] - Added by getItemByName(), aliasing displayProperties.name
 */

/**
 * Each item's lowercased name, in table order, for getItemByName. A temp
 * table lives on the worker's connection to one manifest, so each worker
 * builds it once per manifest: ~350 ms over 30,000 items, after which a
 * search takes ~1.3 ms - against ~290 ms for json_extract over every row's
 * JSON on each search. It also carries each hash, for bootstrap to check
 * against `id`.
 */
const itemNames = `CREATE TEMP TABLE item_names AS
    SELECT id, json_extract(json, '$.hash') AS hash,
        lower_unicode(json_extract(json, '$.displayProperties.name')) AS name
    FROM DestinyInventoryItemDefinition ORDER BY rowid`;

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

        if (!databasePath) {
            return;
        }

        log.info(`Loading the second world from ${databasePath}`);

        try {
            const pool = /** @type {import('./world.js').ManifestPool} */ (this.pool);
            const [
                categoryDefinitions,
                classDefinitions,
                damageTypeDefinitions,
                loreDefinitions,
                [itemCheck],
                [vendorCheck],
            ] = await pool.run({
                databasePath,
                // Built here too, so the worker that loads the manifest is
                // ready for the first search
                setup: [itemNames],
                queries: [
                    'SELECT json FROM DestinyItemCategoryDefinition',
                    'SELECT json FROM DestinyClassDefinition',
                    'SELECT json FROM DestinyDamageTypeDefinition',
                    'SELECT json FROM DestinyLoreDefinition',
                    /**
                     * Items and vendors stay in SQLite, read by `id` (see
                     * ManifestTable), so every row's `id` must be its hash.
                     */
                    `SELECT count(*) AS count,
                        sum((hash & 4294967295) != (id & 4294967295)) AS mismatched
                        FROM temp.item_names`,
                    `SELECT count(*) AS count,
                        sum((json_extract(json, '$.hash') & 4294967295) != (id & 4294967295)) AS mismatched
                        FROM DestinyVendorDefinition`,
                ],
            });

            /** @type {Array<[string, import('./world.js').ManifestRow]>} */
            const checks = [
                ['DestinyInventoryItemDefinition', itemCheck],
                ['DestinyVendorDefinition', vendorCheck],
            ];

            for (const [table, { mismatched }] of checks) {
                if (mismatched) {
                    throw new Error(`${mismatched} ${table} rows have an id other than their hash`);
                }
            }

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

            /** @type {CategoryDefinition[]} */
            this.categories = categoryDefinitions.map(({ json: category }) => JSON.parse(category));
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
            /** @type {ManifestTable<ItemDefinition>} */
            this.items = new ManifestTable({
                pool,
                databasePath,
                table: 'DestinyInventoryItemDefinition',
                length: /** @type {number} */ (itemCheck.count),
            });
            /** @type {Map<number, LoreDefinition>} */
            this.loreDefinitionHashMap = new Map(lores.map(lore => [lore.hash, lore]));
            /** @type {ManifestTable<VendorDefinition>} */
            this.vendors = new ManifestTable({
                pool,
                databasePath,
                table: 'DestinyVendorDefinition',
                length: /** @type {number} */ (vendorCheck.count),
                cacheSize: 50,
            });
        } catch (err) {
            log.error({ err }, 'Error loading the second world');

            throw err;
        }
    }

    /**
     * @returns {Promise<number>}
     */
    async getWeaponCategory() {
        await this.ready();

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
        await this.ready();

        return this.classHashMap.get(classHash);
    }

    /**
     * Get the damage type according to the provided hash.
     * @param {number} damageTypeHash
     * @returns {Promise<DamageTypeDefinition | undefined>}
     */
    async getDamageTypeByHash(damageTypeHash) {
        await this.ready();

        return this.damageTypeHashMap.get(damageTypeHash);
    }

    /**
     * Get item by the hash provided.
     * @param {number} itemHash
     * @returns {Promise<ItemDefinition | undefined>}
     */
    async getItemByHash(itemHash) {
        await this.ready();

        return this.items.get(itemHash);
    }

    /**
     * Look up the item(s) with matching strings in their name(s).
     * @param {string} itemName
     * @returns {Promise<ItemDefinition[]>}
     */
    async getItemByName(itemName) {
        await this.ready();

        const lowerCaseItemName = itemName.trim().toLowerCase();

        if (!lowerCaseItemName) {
            return [];
        }

        // instr, unlike LIKE, has no wildcards for a name to escape
        const items = await this.items.select(
            `SELECT d.json FROM temp.item_names n
                JOIN DestinyInventoryItemDefinition d ON d.id = n.id
                WHERE instr(n.name, ?) > 0 ORDER BY n.rowid`,
            [lowerCaseItemName],
            [itemNames],
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
        await this.ready();

        return this.categoryHashMap.get(itemCategoryHash);
    }

    /**
     * Get the lore by item hash.
     * @param {number} hash
     * @returns {Promise<LoreDefinition | undefined>}
     */
    async getLore(hash) {
        await this.ready();

        return this.loreDefinitionHashMap.get(hash);
    }

    /**
     * Get vendor's icon.
     * @param {number} vendorHash
     * @returns {Promise<string | undefined>}
     */
    async getVendorIcon(vendorHash) {
        await this.ready();

        const vendor = await this.vendors.get(vendorHash);
        const icon = vendor?.displayProperties?.icon;

        return icon ? `https://www.bungie.net${icon}` : undefined;
    }
}

export default World2;
