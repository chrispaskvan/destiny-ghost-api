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
        const run = vi.fn().mockResolvedValue([[], [], [], [], [], []]);
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
    ];
    const vendors = [{ hash: 5, displayProperties: { icon: '/xur.png' } }];
    const temporaryDirectory = mkdtempSync(join(tmpdir(), 'world2-'));
    const fileName = 'world_sql_content.content';
    let manifest;

    beforeAll(async () => {
        const database = new DatabaseSync(join(temporaryDirectory, fileName));
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
                    .run(row.hash | 0, JSON.stringify(row));
            }
        }
        database.close();

        manifest = new World({ pool });
        manifest.directory = temporaryDirectory;
        manifest.bootstrapped = manifest.bootstrap(fileName);
        await manifest.bootstrapped;
    });

    afterAll(() => rmSync(temporaryDirectory, { force: true, recursive: true }));

    it('should look up an item by its hash, including one past 2^31', async () => {
        expect(await manifest.getItemByHash(4_294_967_295)).toEqual(items[0]);
        expect(await manifest.getItemByHash(2)).toEqual(items[1]);
        expect(await manifest.getItemByHash(6)).toBeUndefined();
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

    it('should list every item in table order, as the inventory routes and gRPC read them', () => {
        expect(manifest.items.length).toEqual(items.length);
        // Hashes only: getItemByName, above, adds its aliases to the items it returns
        expect(manifest.items.slice(1, 3).map(({ hash }) => hash)).toEqual([2, 3]);
        expect([...manifest.items.entries()].map(([, { hash }]) => hash)).toEqual(
            items.map(({ hash }) => hash),
        );
    });

    it("should return a vendor's icon", async () => {
        expect(await manifest.getVendorIcon(5)).toEqual('https://www.bungie.net/xur.png');
    });
});
