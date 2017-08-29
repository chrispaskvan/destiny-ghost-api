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
'use strict';
var _ = require('underscore'),
    Q = require('q'),
    S = require('string'),
    fs = require('fs'),
    sqlite3 = require('sqlite3');
/**
 * Get the Destiny class definitions.
 * @returns {*}
 * @private
 */
function getClasses(db) {
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
 *
 */
class World {
    /**
     * @constructor
     */
    constructor() {}

    /**
     * Close the Connection
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
        const deferred = Q.defer();

        getClasses(this.db)
            .then(classes => {
                deferred.resolve(classes.find(characterClass => characterClass.classHash === classHash));
            });

        return deferred.promise;
    }
    /**
     * Get the class by the type provided.
     * @param classType {string}
     * @returns {*}
     */
    getClassByType(classType) {
        const deferred = Q.defer();

        getClasses(this.db)
            .then(classes => deferred.resolve(classes.find(characterClass => characterClass.classType === classType)));

        return deferred.promise;
    }
    /**
     * Get a Random Number of Cards
     * @param numberOfCards {integer}
     * @returns {Promise}
     */
    getGrimoireCards(numberOfCards) {
        const deferred = Q.defer();

        this.db.serialize(() => {
            let cards = [];

            this.db.each('SELECT * FROM DestinyGrimoireCardDefinition WHERE id IN (SELECT id FROM DestinyGrimoireCardDefinition ORDER BY RANDOM() LIMIT ' + // jscs:ignore maximumLineLength
                numberOfCards + ')', (err, row) => err ? deferred.reject(err) : cards.push(JSON.parse(row.json)),
                err => err ? deferred.reject(err) : deferred.resolve(cards));
        });

        return deferred.promise;
    }
    /**
     * Look up the item(s) with matching strings in their name(s).
     * @param itemName {string}
     * @returns {Promise}
     */
    getItemByName(itemName) {
        const deferred = Q.defer();

        this.db.serialize(() => {
            const it = new S(itemName).replaceAll('\'', '\'\'').s;
            let items = [];

            this.db.each('SELECT json FROM DestinyInventoryItemDefinition WHERE json LIKE \'%"itemName":"' +
                it + '%"%\'', (err, row) => err ? deferred.reject(err) : items.push(JSON.parse(row.json)),
                (err, rows) => {
                    if (err) {
                        deferred.reject(err);
                    } else {
                        if (rows === 0) {
                            deferred.resolve([]);
                        } else {
                            const groups = _.groupBy(items, item => item.itemName);
                            const keys = Object.keys(groups);

                            deferred.resolve(_.map(keys, (key) => {
                                return _.min(_.filter(items, (item) => item.itemName === key),
                                    (item) => item.qualityLevel);
                            }));
                        }
                    }
                });
        });

        return deferred.promise;
    }
    /**
     * Get item by the hash provided.
     * @param itemHash
     * @returns {*}
     */
    getItemByHash(itemHash) {
        const deferred = Q.defer();

        this.db.serialize(() => {
            this.db.each('SELECT json FROM DestinyInventoryItemDefinition WHERE json LIKE \'%"itemHash":' +
                itemHash + '%\' LIMIT 1',
                (err, row) => err ? deferred.reject(err) : deferred.resolve(JSON.parse(row.json)));
        });

        return deferred.promise;
    }
    /**
     * Get the category definition for the provided hash.
     * @param itemCategoryHash
     * @returns {Promise}
     */
    getItemCategory(itemCategoryHash) {
        const deferred = Q.defer();

        this.db.serialize(() => {
            this.db.each('SELECT json FROM DestinyItemCategoryDefinition WHERE id = ' +
                itemCategoryHash, (err, row) =>  err ? deferred.reject(err) : deferred.resolve(JSON.parse(row.json)),
                (err, rows) => {
                    if (err) {
                        deferred.reject(err);
                    } else {
                        if (rows === 0) {
                            deferred.reject(new Error('No item category found for hash' +
                                itemCategoryHash));
                        } else {
                            deferred.reject(new Error('Hash, ' +
                                itemCategoryHash + ', is not an unique identifier.'));
                        }
                    }
                });
        });

        return deferred.promise;
    }
    /**
     *
     * @param vendorHash
     * @returns {*|promise}
     */
    getVendorIcon(vendorHash) {
        const deferred = Q.defer();

        this.db.each('SELECT json FROM DestinyVendorDefinition WHERE json LIKE \'%"vendorHash":' +
            vendorHash + '%\' ORDER BY id LIMIT 1',
            (err, row) => err ? deferred.reject(err) :
                deferred.resolve('https://www.bungie.net' + JSON.parse(row.json).summary.vendorIcon),
            (err) => err ? deferred.reject(err) : deferred.resolve());

        return deferred.promise;
    }
    /**
     *
     * @param fileName
     * @returns {Promise}
     */
    open(fileName) {
        return new Promise((resolve, reject) => {
            if (!fs.existsSync(fileName)) {
                reject(new Error('Database file not found.'));
            }
            this.db = new sqlite3.Database(fileName, () => resolve());
        });
    }
}

exports = module.exports = new World();
