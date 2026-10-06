/**
 * World Model Tests
 */
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import World from './world2.js';
import itif from './itif.js';
import log from './log.js';
import pool from './pool.js';
import { xurHash } from '../destiny2/destiny2.constants.js';

vi.mock('./log.js', () => ({
    default: {
        error: vi.fn(),
        info: vi.fn(),
        warn: vi.fn(),
    },
}));

const directory = process.env.DESTINY2_DATABASE_DIR;
let world;

beforeAll(async () => {
    world = new World({
        directory,
        pool,
    });

    await world.bootstrapped;
});

describe('bootstrap', () => {
    const databaseDirectory = '/app/databases/destiny2';

    beforeEach(() => {
        vi.mocked(log.error).mockClear();
        vi.mocked(log.info).mockClear();
        vi.mocked(log.warn).mockClear();
    });

    it('should skip the load silently when no manifest is on disk', async () => {
        const run = vi.fn();
        const world2 = new World({ pool: { run } });

        world2.directory = databaseDirectory;

        await world2.bootstrap();

        expect(run).not.toHaveBeenCalled();
        expect(log.info).not.toHaveBeenCalled();
        expect(log.warn).not.toHaveBeenCalled();
    });

    it('should log the path of the manifest it loads', async () => {
        const run = vi.fn().mockResolvedValue([[], [], [], [], [{ count: 0 }], [{ count: 0 }]]);
        const world2 = new World({ pool: { run } });

        world2.directory = databaseDirectory;

        await world2.bootstrap('world_sql_content.content');

        expect(run).toHaveBeenCalled();
        expect(log.info).toHaveBeenCalledWith(
            `Loading the second world from ${join(databaseDirectory, 'world_sql_content.content')}`,
        );
    });

    it('should log the error and rethrow when the manifest cannot be read', async () => {
        const err = new Error('no such table: DestinyInventoryItemDefinition');
        const run = vi.fn().mockRejectedValue(err);
        const world2 = new World({ pool: { run } });

        world2.directory = databaseDirectory;

        await expect(world2.bootstrap('world_sql_content.content')).rejects.toThrow(err);

        expect(log.error).toHaveBeenCalledWith({ err }, 'Error loading the second world');
    });
});

describe("It's Bungie's 2nd world. You're just querying it.", () => {
    itif(
        'should return the lore for Ghost Primus',
        () => existsSync(directory),
        async () => {
            const {
                displayProperties: { name },
            } = await world.getLore(2505533224);

            expect(name).toEqual('Ghost Primus');
        },
    );

    itif(
        'should return the item category Hand Cannon',
        () => existsSync(directory),
        async () => {
            const {
                displayProperties: { name },
            } = await world.getItemCategory(6);

            expect(name).toEqual('Hand Cannon');
        },
    );

    itif(
        'should return the Hunter character class',
        () => existsSync(directory),
        async () => {
            const {
                displayProperties: { name },
            } = await world.getClassByHash(671679327);

            expect(name).toEqual('Hunter');
        },
    );

    itif(
        'should return Night Watch',
        () => existsSync(directory),
        async () => {
            const itemName = 'Night Watch';
            const items = await world.getItemByName(itemName);

            expect(items[0].displayProperties.name).toEqual(itemName);
        },
    );

    itif(
        'should return the icon of the Agent of Nine',
        () => existsSync(directory),
        async () => {
            const url = await world.getVendorIcon(xurHash);

            expect(url).toBeDefined();
        },
    );

    itif(
        'should return the category hash for weapons',
        () => existsSync(directory),
        async () => {
            const weaponCategory = await world.getWeaponCategory();

            expect(weaponCategory).toEqual(1);
        },
    );
});

/**
 * A manifest of a few rows, read through the real worker pool, so the
 * queries' json_extract columns are exercised rather than mocked.
 */
describe('when items and vendors are read from the manifest', () => {
    const items = [
        { hash: 4_294_967_295, displayProperties: { name: 'Night Watch' }, flavorText: 'a' },
        { hash: 2, displayProperties: { name: 'Ace of Spades' }, itemTypeAndTierDisplayName: 'b' },
        { hash: 3, displayProperties: {} },
        { hash: 4, displayProperties: { name: 'NIGHTSHADE' } },
        // Uppercase beyond ASCII, which SQLite's lower() and LIKE leave alone
        { hash: 6, displayProperties: { name: 'ÆON SAFE' } },
    ];
    const vendors = [{ hash: 5, displayProperties: { icon: '/xur.png' } }];
    const temporaryDirectory = mkdtempSync(join(tmpdir(), 'world2-'));
    const fileName = 'world_sql_content.content';
    let manifest;

    /**
     * A manifest as Bungie builds it: each row's `id` is its hash as a signed
     * 32-bit integer, unless `idOf` says otherwise.
     */
    const createManifest = (name, idOf = ({ hash }) => hash | 0) => {
        const database = new DatabaseSync(join(temporaryDirectory, name));
        const tables = {
            DestinyItemCategoryDefinition: [],
            DestinyClassDefinition: [],
            DestinyDamageTypeDefinition: [],
            DestinyInventoryItemDefinition: items,
            DestinyLoreDefinition: [],
            DestinyVendorDefinition: vendors,
        };

        for (const [table, rows] of Object.entries(tables)) {
            database.exec(`CREATE TABLE ${table} (id INTEGER PRIMARY KEY, json BLOB)`);
            for (const row of rows) {
                database
                    .prepare(`INSERT INTO ${table} (id, json) VALUES (?, ?)`)
                    .run(idOf(row), JSON.stringify(row));
            }
        }
        database.close();
    };

    beforeAll(async () => {
        createManifest(fileName);

        manifest = new World({ pool });
        manifest.directory = temporaryDirectory;
        await manifest.load(fileName);
    });

    afterAll(() => rmSync(temporaryDirectory, { force: true, recursive: true }));

    it('should wait for the first manifest instead of failing before it loads', async () => {
        const fresh = new World({ pool });

        fresh.directory = temporaryDirectory;

        // As /health and Twilio do while a fresh container downloads its manifest
        const found = fresh.getItemByName('spades');

        await fresh.load(fileName);

        expect((await found).map(({ hash }) => hash)).toEqual([2]);
    });

    it('should reject with a clear error, as a 503, when no manifest loads in time', async () => {
        await expect(new World({ pool }).ready(20)).rejects.toMatchObject({
            message: 'The Destiny manifest is still loading',
            statusCode: 503,
        });
    });

    /**
     * Requests time out at 5 seconds (loaders/express.js). Waiting as long
     * meant the request was cut off first, with no response sent.
     */
    it('should give up by default well before the request timeout', async () => {
        const started = performance.now();

        await expect(new World({ pool }).ready()).rejects.toThrow('still loading');

        expect(performance.now() - started).toBeLessThan(3000);
    });

    it('should keep serving the loaded world when a reload fails', async () => {
        vi.spyOn(pool, 'run').mockRejectedValueOnce(new Error('database disk image is malformed'));

        await expect(manifest.load(fileName)).rejects.toThrow('database disk image is malformed');

        expect(await manifest.getItemByHash(2)).toEqual(items[1]);
    });

    it('should look up an item by its hash, including one past 2^31', async () => {
        expect(await manifest.getItemByHash(4_294_967_295)).toEqual(items[0]);
        expect(await manifest.getItemByHash(2)).toEqual(items[1]);
        expect(await manifest.getItemByHash(7)).toBeUndefined();
    });

    it('should search names case-insensitively, in table order, with their aliases', async () => {
        const found = await manifest.getItemByName(' night ');

        expect(found.map(({ hash }) => hash)).toEqual([4_294_967_295, 4]);
        expect(found[0]).toEqual({
            ...items[0],
            itemCategory: undefined,
            itemName: 'Night Watch',
        });
        expect(await manifest.getItemByName('spades')).toEqual([
            { ...items[1], itemCategory: 'b', itemName: 'Ace of Spades' },
        ]);
    });

    it('should list every item in table order, as the inventory routes and gRPC read them', async () => {
        const listed = [];

        // Two at a time, so the listing has to pick up where each batch ended
        for await (const [index, { hash }] of manifest.items.entries(2)) {
            listed.push([index, hash]);
        }

        expect(manifest.items.length).toEqual(items.length);
        expect(await manifest.items.slice(1, 3)).toEqual(items.slice(1, 3));
        expect(await manifest.items.slice(4, 99)).toEqual(items.slice(4));
        expect(await manifest.items.slice(3, 3)).toEqual([]);
        expect(listed).toEqual(items.map(({ hash }, index) => [index, hash]));
    });

    it('should search names beyond ASCII as toLowerCase() folds them', async () => {
        expect((await manifest.getItemByName('æon')).map(({ hash }) => hash)).toEqual([6]);
    });

    it('should search names literally, with no wildcards', async () => {
        expect(await manifest.getItemByName('%')).toEqual([]);
        expect(await manifest.getItemByName('_')).toEqual([]);
    });

    it('should return the same object for an item read again', async () => {
        expect(await manifest.getItemByHash(3)).toBe(await manifest.getItemByHash(3));
    });

    it("should keep the item table out of this process's heap", () => {
        expect(manifest).not.toHaveProperty('itemNames');
        expect(manifest).not.toHaveProperty('itemHashMap');
    });

    /**
     * Items are read by `id`; were it not the hash, every lookup would miss,
     * silently. A load that finds that fails, keeping the world it had.
     */
    it("should refuse a manifest whose ids aren't its hashes", async () => {
        const mismatched = 'mismatched.content';
        const world = new World({ pool });

        createManifest(mismatched, ({ hash }) => hash + 1_000);
        world.directory = temporaryDirectory;

        await expect(world.load(mismatched)).rejects.toThrow(
            `${items.length} DestinyInventoryItemDefinition rows have an id other than their hash`,
        );
    });

    it("should return a vendor's icon", async () => {
        expect(await manifest.getVendorIcon(5)).toEqual('https://www.bungie.net/xur.png');
    });
});
