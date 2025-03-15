import Database from 'better-sqlite3';

export default async function ({ databasePath, queries }) {
    const database = new Database(databasePath, {
        readonly: true,
        fileMustExist: true,
    });
    const results = queries.map(query => database.prepare(query).all());

    database.close();

    return results;
}
