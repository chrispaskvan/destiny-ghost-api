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
	Sequelize = require('sequelize'),
	World = require('./world');

/**
 * World2 Repository
 */
class World2 extends World {
	constructor() {
		super();

		this.sequelize = new Sequelize({
			dialect: 'sqlite',
			pool: {
				max: 5,
				min: 0,
				acquire: 30000,
				idle: 10000
			},
			storage: './databases/world_sql_content_e5b3365414a1273a84dd5d953f254790.content'
		});

	}
    /**
     * Get the class according to the provided hash.
     * @param classHash {string}
     */
    getClassByHash(classHash) {
        return this._getClasses(this.db)
            .then(classes => {
                return classes.find(characterClass => characterClass.hash === classHash);
            });
    }

    /**
     * Look up the item(s) with matching strings in their name(s).
     * @param itemName {string}
     * @returns {Promise}
     */
    getItemByName(itemName) {
        return new Promise((resolve, reject) => {
            this.db.serialize(() => {
                const it = itemName.replace(/'/g, '\'\'');
                let items = [];

                this.db.each(`SELECT json FROM DestinyInventoryItemDefinition WHERE json LIKE '%"name":"${it}%"%'`, (err, row) => err ? reject(err) : items.push(JSON.parse(row.json)),
                    (err, rows) => {
                        if (err) {
                            reject(err);
                        } else {
                            if (rows === 0) {
                                resolve([]);
                            } else {
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
                            }
                        }
                    });
            });
        });
    }

    /**
     * Get item by the hash provided.
     * @param itemHash
     * @returns {*}
     */
    getItemByHash(itemHash) {
        return new Promise((resolve, reject) => {
            this.db.serialize(() => {
                this.db.each(`SELECT json FROM DestinyInventoryItemDefinition WHERE json LIKE '%"hash":${itemHash}%' LIMIT 1`,
                    (err, row) => err ? reject(err) : resolve(JSON.parse(row.json)));
            });
        });
    }

    /**
     * Get the category definition for the provided hash.
     * @param itemCategoryHash
     * @returns {Promise}
     */
    getItemCategory(itemCategoryHash) {
        return new Promise((resolve, reject) => {
			this.db.serialize(() => {
				let categories = [];

				this.db.each(`SELECT json FROM DestinyItemCategoryDefinition WHERE json LIKE '%"hash":${itemCategoryHash},%' LIMIT 1`,
					(err, row) =>  err ? reject(err) : categories.push(JSON.parse(row.json)),
                    (err, rows) => {
                        if (err) {
                            reject(err);
                        } else {
                            if (rows === 0) {
                                reject(new Error('No item category found for hash' +
                                    itemCategoryHash));
                            } else {
								if (rows > 1) {
									reject(new Error('Hash, ' +
										itemCategoryHash + ', is not an unique identifier.'));
								}

                                resolve(categories[0]);
                            }
                        }
                    });
            });
        });
    }

	/**
     * Get the lore by item hash.
	 * @param hash
	 * @returns {Promise}
	 */
	getLore(hash) {
		return new Promise((resolve, reject) => {
			this.db.serialize(() => {
				this.db.each(`SELECT json FROM DestinyLoreDefinition WHERE json LIKE \'%"hash":${hash}%' LIMIT 1`,
					(err, row) => err ? reject(err) : resolve(JSON.parse(row.json)));
			});
		});
	}
}

module.exports = World2;
