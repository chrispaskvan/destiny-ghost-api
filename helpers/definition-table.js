// @ts-check
/**
 * A manifest table kept as the JSON text SQLite returned, each definition
 * parsed the first time it is read and cached after that.
 *
 * Parsing DestinyInventoryItemDefinition up front took ~920 ms of the main
 * thread on every bootstrap - at startup and whenever Bungie publishes a new
 * manifest - while most of its definitions are never read. Reading it through
 * this instead spreads that cost over the lookups that need it.
 *
 * It answers what the inventory routes and gRPC ask of the array it
 * replaces: `length`, `entries()` and `slice()`, in table order.
 *
 * @template T
 */
class DefinitionTable {
    /** @type {Map<number, string | T>} */
    #definitions = new Map();

    /** @type {number[]} */
    #hashes = [];

    /**
     * @param {Array<{ hash: number, json: string }>} rows
     */
    constructor(rows) {
        for (const { hash, json } of rows) {
            this.#definitions.set(hash, json);
            this.#hashes.push(hash);
        }
    }

    get length() {
        return this.#hashes.length;
    }

    /**
     * @param {number} hash
     * @returns {T | undefined}
     */
    get(hash) {
        const definition = this.#definitions.get(hash);

        if (typeof definition !== 'string') {
            return definition;
        }

        /** @type {T} */
        const parsed = JSON.parse(definition);

        this.#definitions.set(hash, parsed);

        return parsed;
    }

    /**
     * @param {number} [start]
     * @param {number} [end]
     * @returns {T[]}
     */
    slice(start, end) {
        return this.#hashes.slice(start, end).map(hash => /** @type {T} */ (this.get(hash)));
    }

    /**
     * Parses one definition per step, so a caller that yields between steps
     * - as the inventory stream does, awaiting each write - never holds the
     * event loop for the whole table.
     *
     * @returns {Generator<[number, T]>}
     */
    *entries() {
        for (const [index, hash] of this.#hashes.entries()) {
            yield [index, /** @type {T} */ (this.get(hash))];
        }
    }
}

export default DefinitionTable;
