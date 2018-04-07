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
    fs = require('fs'),
    sqlite3 = require('sqlite3');

/**
 * World Repository
 */
class World {
    /**
     * Get the Destiny class definitions.
     * @returns {*}
     * @private
     */
    _getClasses(db) {
        return new Promise((resolve, reject) => {
            db.serialize(() => {
                let classes = [];

                db.each('SELECT json FROM DestinyClassDefinition',
                    (err, row) => err ? reject(err) : classes.push(JSON.parse(row.json)),
                    err => err ? reject(err) : resolve(classes));
            });
        });
    }

    /**
     * Close database connection.
     * @returns {Promise}
     */
    close() {
        if (this.db) {
            this.db.close();
        }

        return Promise.resolve();
    }
    /**
     * Get the class according to the provided hash.
     * @param classHash {string}
     */
    getClassByHash(classHash) {
        return this._getClasses(this.db)
            .then(classes => {
                return classes.find(characterClass => characterClass.classHash === classHash);
            });
    }

    /**
     * Get the class by the type provided.
     * @param classType {string}
     * @returns {*}
     */
    getClassByType(classType) {
        return this._getClasses(this.db)
            .then(classes => classes.find(characterClass => characterClass.classType === classType));
    }

    /**
     * Get a Random Number of Cards
     * @param numberOfCards {integer}
     * @returns {Promise}
     */
    getGrimoireCards(numberOfCards) {
        return new Promise((resolve, reject) => {
            this.db.serialize(() => {
                let cards = [];

                this.db.each(`SELECT * FROM DestinyGrimoireCardDefinition WHERE id IN (SELECT id FROM DestinyGrimoireCardDefinition ORDER BY RANDOM() LIMIT ${numberOfCards})`, (err, row) => err ? reject(err) : cards.push(JSON.parse(row.json)),
                    err => err ? reject(err) : resolve(cards));
            });
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
                const it = itemName.replace(/\'/g, '\'\'');
                let items = [];

                this.db.each(`SELECT json FROM DestinyInventoryItemDefinition WHERE json LIKE \'%"itemName":"${it}%"%'`,
                    (err, row) => err ? reject(err) : items.push(JSON.parse(row.json)),
                    (err, rows) => {
                        if (err) {
                            reject(err);
                        } else {
                            if (rows === 0) {
                                resolve([]);
                            } else {
                                const groups = _.groupBy(items, item => item.itemName);
                                const keys = Object.keys(groups);

                                resolve(_.map(keys, (key) => {
                                    return _.min(_.filter(items, (item) => item.itemName === key),
                                        (item) => item.qualityLevel);
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
                this.db.each(`SELECT json FROM DestinyInventoryItemDefinition WHERE json LIKE '%"itemHash":${itemHash}%' LIMIT 1`,
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

				this.db.each(`SELECT json FROM DestinyItemCategoryDefinition WHERE id = ${itemCategoryHash}`,
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
     * Get vendor's icon.
     * @param vendorHash
     * @returns {*|promise}
     */
    getVendorIcon(vendorHash) {
        return new Promise((resolve, reject) => {
            this.db.each(`SELECT json FROM DestinyVendorDefinition WHERE json LIKE '%"vendorHash":${vendorHash}%' ORDER BY id LIMIT 1`,
                (err, row) => err ? reject(err) :
                    resolve('https://www.bungie.net' + JSON.parse(row.json).summary.vendorIcon),
                (err) => err ? reject(err) : resolve());
        });
    }

    /**
     * Open database connection.
     * @param fileName
     * @returns {Promise}
     */
    open(fileName) {
        return new Promise((resolve, reject) => {
            if (!fs.existsSync(fileName)) {
                reject(new Error('Database file not found.'));
            }
            this.db = new sqlite3.Database(fileName, sqlite3.OPEN_READONLY, () => resolve());
        });
    }
}

module.exports = World;
