// @ts-check
import { DatabaseSync } from 'node:sqlite';

/**
 * @param {{ databasePath: string, queries: string[] }} params
 * @returns {Promise<import('./world.js').ManifestRow[][]>}
 */
export default async function ({ databasePath, queries }) {
    /** @type {DatabaseSync | undefined} */
    let database;

    try {
        database = new DatabaseSync(databasePath, { readOnly: true });
        // Reassigning `database` above doesn't narrow it inside this closure
        // (it stays `DatabaseSync | undefined` there); bind it to a local
        // const so `.map()` can see it's always defined.
        const db = database;

        const results = queries.map(
            query => /** @type {import('./world.js').ManifestRow[]} */ (db.prepare(query).all()),
        );

        return results;
    } catch (err) {
        throw new Error(
            `Failed to load the database: ${err instanceof Error ? err.message : String(err)}`,
            {
                cause: err,
            },
        );
    } finally {
        if (database) {
            database.close();
        }
    }
}
