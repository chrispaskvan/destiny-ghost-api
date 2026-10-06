// @ts-check
import { LRUCache as LruCache } from 'lru-cache';

/**
 * A manifest table read on demand from the SQLite database, through the
 * worker pool, rather than held in this process.
 *
 * Holding DestinyInventoryItemDefinition in memory, even as unparsed JSON,
 * took ~315 MB of a 768 MB heap on the production plan: loading it froze the
 * event loop for 45 seconds in garbage collection, with the host swapping,
 * at every deploy and whenever Bungie published a new manifest.
 *
 * Rows are read by `id`, which in Bungie's manifests holds the hash as a
 * signed 32-bit integer (World2#bootstrap checks every row). Definitions
 * read by hash are cached, so a hot item is parsed once.
 *
 * It answers what the inventory routes and gRPC ask of a list - `length`,
 * `slice()` and `entries()`, in table order - asynchronously.
 *
 * @template {{ hash: number }} T
 */
class ManifestTable {
    /** @type {import('./world.js').ManifestPool} */
    #pool;

    /** @type {string} */
    #databasePath;

    /** @type {string} */
    #table;

    /** @type {number} */
    #length;

    /** @type {LruCache<number, T>} */
    #cache;

    /**
     * @param {{
     *   pool: import('./world.js').ManifestPool,
     *   databasePath: string,
     *   table: string,
     *   length: number,
     *   cacheSize?: number,
     * }} options - `table` is interpolated into SQL, so it must be a
     * constant, never input.
     */
    constructor({ pool, databasePath, table, length, cacheSize = 500 }) {
        this.#pool = pool;
        this.#databasePath = databasePath;
        this.#table = table;
        this.#length = length;
        this.#cache = new LruCache({ max: cacheSize });
    }

    get length() {
        return this.#length;
    }

    /**
     * @param {string} sql
     * @param {Array<import('node:sqlite').SQLInputValue>} [parameters]
     * @param {string[]} [setup]
     */
    async #query(sql, parameters = [], setup = []) {
        const [rows] = await this.#pool.run({
            databasePath: this.#databasePath,
            queries: [sql],
            parameters: [parameters],
            setup,
        });

        return rows;
    }

    /**
     * @param {number} hash
     * @returns {Promise<T | undefined>}
     */
    async get(hash) {
        const cached = this.#cache.get(hash);

        if (cached) {
            return cached;
        }

        const [row] = await this.#query(`SELECT json FROM ${this.#table} WHERE id = ?`, [hash | 0]);

        return row ? this.#cached(JSON.parse(row.json)) : undefined;
    }

    /**
     * Definitions from a query of this table's `json` column, by way of the
     * cache, so a definition already read is the same object.
     *
     * @param {string} sql
     * @param {Array<import('node:sqlite').SQLInputValue>} [parameters]
     * @param {string[]} [setup] - see helpers/worker.js
     * @returns {Promise<T[]>}
     */
    async select(sql, parameters, setup) {
        const rows = await this.#query(sql, parameters, setup);

        return rows.map(({ json }) => {
            /** @type {T} */
            const definition = JSON.parse(json);

            return this.#cache.get(definition.hash) ?? this.#cached(definition);
        });
    }

    /** @param {T} definition */
    #cached(definition) {
        this.#cache.set(definition.hash, definition);

        return definition;
    }

    /**
     * Definitions `start` to `end` in table order, freshly parsed: listing
     * the table must not flush the cache of definitions read by hash.
     *
     * Unlike Array#slice, a negative `start` is refused rather than counted
     * from the end: SQLite reads a negative OFFSET as 0, and a limit past
     * 2^53 is no longer an integer it accepts.
     *
     * @param {number} [start]
     * @param {number} [end]
     * @returns {Promise<T[]>}
     */
    async slice(start = 0, end = this.#length) {
        if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0) {
            throw new RangeError(
                `slice(${start}, ${end}) needs a start of 0 or more and safe integers`,
            );
        }

        const limit = Math.max(0, end - start);

        if (!limit) {
            return [];
        }

        const rows = await this.#query(
            `SELECT json FROM ${this.#table} ORDER BY rowid LIMIT ? OFFSET ?`,
            [limit, start],
        );

        return rows.map(({ json }) => JSON.parse(json));
    }

    /**
     * Every definition in table order, a batch at a time: each batch picks
     * up after the last row of the one before, rather than OFFSET, which
     * would step over every earlier row again.
     *
     * @param {number} [batchSize]
     * @returns {AsyncGenerator<[number, T]>}
     */
    async *entries(batchSize = 200) {
        let index = 0;
        let after = Number.MIN_SAFE_INTEGER;

        while (true) {
            const rows = await this.#query(
                `SELECT rowid AS position, json FROM ${this.#table} WHERE rowid > ? ORDER BY rowid LIMIT ?`,
                [after, batchSize],
            );

            for (const { json } of rows) {
                yield [index, JSON.parse(json)];
                index += 1;
            }

            if (rows.length < batchSize) {
                return;
            }

            after = /** @type {number} */ (rows.at(-1)?.position);
        }
    }
}

export default ManifestTable;
