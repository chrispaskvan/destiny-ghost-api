import Database from 'better-sqlite3';

export default async function ({ databasePath, queries }) {
    let database;

    try {
        database = new Database(databasePath, {
            readonly: true,
            fileMustExist: true,
        });
        const results = queries.map(query => database.prepare(query).all());

        database.close();

        return results;
    }
    catch (err) {
        throw new Error(`Failed to load the database: ${err.message}`);
    }
    finally {
        if (database) {
            database.close();
        }
    }
}
