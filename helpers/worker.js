// @ts-check
import { DatabaseSync } from 'node:sqlite';

/**
 * Read-only connections to manifest databases, kept open for this worker's
 * lifetime: opening the file and preparing statements cost ~650 µs per task
 * on a laptop (more on the production plan), a lookup through an open
 * connection ~9 µs.
 *
 * Keyed by path, since the Destiny and Destiny 2 manifests share this pool.
 * A new manifest arrives under a new file name; the least recently used
 * connection is closed once more than `maxConnections` are open, which
 * retires the old one.
 *
 * @typedef {Object} Connection
 * @property {DatabaseSync} database
 * @property {Map<string, import('node:sqlite').StatementSync>} statements
 * @property {Set<string>} setUp - setup statements already run
 */

const maxConnections = 3;

/** @type {Map<string, Connection>} */
const connections = new Map();

/**
 * @param {string} databasePath
 * @returns {Connection}
 */
const connect = databasePath => {
    let connection = connections.get(databasePath);

    if (connection) {
        // Most recently used last, so the first entry is the one to close
        connections.delete(databasePath);
    } else {
        const database = new DatabaseSync(databasePath, { readOnly: true });

        /**
         * SQLite's lower() and LIKE fold ASCII only. Lowercasing as
         * JavaScript does keeps name search matching what it did when it ran
         * over String.prototype.toLowerCase().
         */
        database.function('lower_unicode', { deterministic: true }, value =>
            typeof value === 'string' ? value.toLowerCase() : value,
        );
        connection = { database, statements: new Map(), setUp: new Set() };
    }

    connections.set(databasePath, connection);

    for (const [path, { database }] of connections) {
        if (connections.size <= maxConnections) {
            break;
        }
        database.close();
        connections.delete(path);
    }

    return connection;
};

/**
 * @param {Connection} connection
 * @param {string} sql
 */
const prepare = ({ database, statements }, sql) => {
    let statement = statements.get(sql);

    if (!statement) {
        statement = database.prepare(sql);
        statements.set(sql, statement);
    }

    return statement;
};

/**
 * Runs `queries` against the manifest at `databasePath`, each with its own
 * entry in `parameters`. `setup` statements run once per connection, before
 * the first query that needs them - for example a temp table a query reads.
 *
 * @param {{
 *   databasePath: string,
 *   queries: string[],
 *   parameters?: Array<Array<import('node:sqlite').SQLInputValue> | undefined>,
 *   setup?: string[],
 * }} params
 * @returns {Promise<import('./world.js').ManifestRow[][]>}
 */
export default async function ({ databasePath, queries, parameters = [], setup = [] }) {
    try {
        const connection = connect(databasePath);

        for (const sql of setup) {
            if (!connection.setUp.has(sql)) {
                connection.database.exec(sql);
                connection.setUp.add(sql);
            }
        }

        return queries.map(
            (query, index) =>
                /** @type {import('./world.js').ManifestRow[]} */ (
                    prepare(connection, query).all(...(parameters[index] ?? []))
                ),
        );
    } catch (err) {
        // A connection that failed may be to a file that is gone or corrupt
        connections.get(databasePath)?.database.close();
        connections.delete(databasePath);

        throw new Error(
            `Failed to load the database: ${err instanceof Error ? err.message : String(err)}`,
            {
                cause: err,
            },
        );
    }
}
