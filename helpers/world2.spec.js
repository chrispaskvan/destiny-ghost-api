/**
 * World Model Tests
 */
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
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
