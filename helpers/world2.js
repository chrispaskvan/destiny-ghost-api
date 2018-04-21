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
const _ = require('underscore'),
	Database = require('better-sqlite3'),
	World = require('./world'),
	path = require('path');

/**
 * World2 Repository
 */
class World2 extends World {
	constructor(options = {}) {
		super(options);

		this._bootstrap(this.database);
	}

	_bootstrap(fileName) {
		const databasePath = fileName ?
			path.join(this.directory, path.basename(fileName)) : undefined;

		if (databasePath) {
			const database = new Database(databasePath, {
				readonly: true,
				fileMustExist: true
			});

			const categories = database.prepare('SELECT json FROM DestinyItemCategoryDefinition').all();
			const classes = database.prepare('SELECT json FROM DestinyClassDefinition').all();
			const items = database.prepare('SELECT json FROM DestinyInventoryItemDefinition').all();
			const loreDefinitions = database.prepare('SELECT json FROM DestinyLoreDefinition').all();
			const vendors = database.prepare('SELECT json FROM DestinyVendorDefinition').all();

			database.close();

			this.categories = categories.map(({ json: category }) => JSON.parse(category));
			this.classes = classes.map(({ json: classDefinition }) => JSON.parse(classDefinition));
			this.items = items.map(({ json: item }) => JSON.parse(item));
			this.loreDefinitions = loreDefinitions.map(({ json: lore }) => JSON.parse(lore));
			this.vendors = vendors.map(({ json: vendor }) => JSON.parse(vendor));
		}
	}


	/**
	 * Get item by the hash provided.
	 * @param itemHash
	 * @returns {*}
	 */
	getItemByHash(itemHash) {
		return new Promise((resolve, reject) => {
			try {
				const [item] = this.items.filter(item => item.hash === itemHash);

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
	    return new Promise((resolve, reject) => {
		    try {
			    const items = this.items.filter(({ displayProperties: { name } = '' }) =>
				    name.toLowerCase().includes(itemName.toLowerCase()));

			    const groups = _.groupBy(items, item => item.displayProperties.name);
			    const keys = Object.keys(groups);

			    resolve(_.map(keys, (key) => {
				    const item = _.min(_.filter(items, (item) => item.displayProperties.name === key),
					    (item) => item.quality ? item.quality.qualityLevel : 0);

				    return Object.assign(item, {
					    itemCategory: item.itemTypeAndTierDisplayName,
					    itemName: item.displayProperties.name
				    })
			    }));
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
		return Promise.resolve(this.categories.find(category => category.hash === itemCategoryHash));
	}

	/**
     * Get the lore by item hash.
	 * @param hash
	 * @returns {Promise}
	 */
	getLore(hash) {
		return Promise.resolve(this.loreDefinitions.find(lore => lore.hash === hash));
	}
}

module.exports = World2;
