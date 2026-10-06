import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The real SQLite, with its constructor counted, so these specs can tell a
 * connection reused from one reopened.
 */
vi.mock('node:sqlite', async importOriginal => {
    const actual = await importOriginal();

    return {
        ...actual,
        // biome-ignore lint/complexity/useArrowFunction: function expression required — called with `new`
        DatabaseSync: vi.fn(function (...args) {
            return new actual.DatabaseSync(...args);
        }),
    };
});

const directory = mkdtempSync(join(tmpdir(), 'worker-'));
/** @param {string} name */
const pathOf = name => join(directory, `${name}.content`);
const items = [
    { hash: 1, displayProperties: { name: 'Ace of Spades' } },
    { hash: 2, displayProperties: { name: 'Örnsköldsvik' } },
];
let worker;

beforeAll(async () => {
    const { DatabaseSync: Actual } = await vi.importActual('node:sqlite');

    for (const name of ['a', 'b', 'c', 'd']) {
        const database = new Actual(pathOf(name));

        database.exec('CREATE TABLE Items (id INTEGER PRIMARY KEY, json BLOB)');
        for (const item of items) {
            database
                .prepare('INSERT INTO Items (id, json) VALUES (?, ?)')
                .run(item.hash, JSON.stringify(item));
        }
        database.close();
    }
});

afterAll(() => rmSync(directory, { force: true, recursive: true }));

beforeEach(async () => {
    // Fresh module state, so each spec starts with no open connections
    vi.resetModules();
    vi.mocked(DatabaseSync).mockClear();
    ({ default: worker } = await import('./worker.js'));
});

describe('worker', () => {
    it('should run each query with its own parameters', async () => {
        const results = await worker({
            databasePath: pathOf('a'),
            queries: ['SELECT json FROM Items WHERE id = ?', 'SELECT count(*) AS count FROM Items'],
            parameters: [[2]],
        });

        expect(results).toEqual([[{ json: JSON.stringify(items[1]) }], [{ count: 2 }]]);
        expect(DatabaseSync).toHaveBeenCalledWith(pathOf('a'), { readOnly: true });
    });

    it('should open a manifest once and reuse the connection', async () => {
        for (const id of [1, 2, 1]) {
            await worker({
                databasePath: pathOf('a'),
                queries: ['SELECT json FROM Items WHERE id = ?'],
                parameters: [[id]],
            });
        }

        expect(DatabaseSync).toHaveBeenCalledOnce();
    });

    it('should run setup once per connection', async () => {
        const task = {
            databasePath: pathOf('a'),
            // Would fail with "already exists" were it run twice
            setup: ['CREATE TEMP TABLE names AS SELECT id FROM Items'],
            queries: ['SELECT count(*) AS count FROM temp.names'],
        };

        await worker(task);

        expect(await worker(task)).toEqual([[{ count: 2 }]]);
    });

    it('should keep a connection per manifest, closing the least recently used past three', async () => {
        const task = name => worker({ databasePath: pathOf(name), queries: ['SELECT 1 AS one'] });

        await task('a');
        await task('b');
        await task('c');
        await task('a'); // now the most recently used
        await task('d'); // closes b
        expect(DatabaseSync).toHaveBeenCalledTimes(4);

        await task('a');
        await task('c');
        await task('d');
        expect(DatabaseSync).toHaveBeenCalledTimes(4);

        await task('b');
        expect(DatabaseSync).toHaveBeenCalledTimes(5);
    });

    it('should lowercase names as JavaScript does, beyond ASCII', async () => {
        const [[{ name }]] = await worker({
            databasePath: pathOf('a'),
            queries: [
                "SELECT lower_unicode(json_extract(json, '$.displayProperties.name')) AS name FROM Items WHERE id = 2",
            ],
        });

        expect(name).toEqual('örnsköldsvik');
    });

    it('should wrap a failure and reopen the manifest on the next task', async () => {
        await expect(
            worker({ databasePath: pathOf('a'), queries: ['SELECT * FROM Missing'] }),
        ).rejects.toThrow('Failed to load the database: no such table: Missing');

        await worker({ databasePath: pathOf('a'), queries: ['SELECT 1 AS one'] });

        expect(DatabaseSync).toHaveBeenCalledTimes(2);
    });

    it('should wrap a manifest that cannot be opened', async () => {
        await expect(
            worker({ databasePath: pathOf('missing'), queries: ['SELECT 1'] }),
        ).rejects.toThrow('Failed to load the database');
    });
});
