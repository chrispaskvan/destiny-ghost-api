import { DatabaseSync } from 'node:sqlite';

export default async function ({ databasePath, queries }) {
    let database;

    try {
        database = new DatabaseSync(databasePath, { readOnly: true });

        const results = queries.map(query => database.prepare(query).all());

        return results;
    } catch (err) {
        throw new Error(`Failed to load the database: ${err.message}`, { cause: err });
    } finally {
        if (database) {
            database.close();
        }
    }
}
