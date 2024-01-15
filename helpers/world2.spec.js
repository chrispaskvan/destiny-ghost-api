/**
 * World Model Tests
 */
import { existsSync } from 'fs';
import {
    beforeAll, describe, expect,
} from 'vitest';
import World from './world2';
import itif from './itif';
import { xurHash } from '../destiny2/destiny2.constants';

const directory = process.env.DESTINY2_DATABASE_DIR;
let world;

beforeAll(() => {
    world = new World({
        directory,
    });
});

describe('It\'s Bungie\'s 2nd world. You\'re just querying it.', () => {
    itif(
        'should return the lore for Ghost Primus',
        () => existsSync(directory), // eslint-disable-line security/detect-non-literal-fs-filename, max-len
        async () => {
            const { displayProperties: { name } } = world.getLore(2505533224);

            expect(name).toEqual('Ghost Primus');
        },
    );

    itif(
        'should return the item category Hand Cannon',
        () => existsSync(directory), // eslint-disable-line security/detect-non-literal-fs-filename, max-len
        async () => {
            const { displayProperties: { name } } = world.getItemCategory(6);

            expect(name).toEqual('Hand Cannon');
        },
    );

    itif(
        'should return the Hunter character class',
        () => existsSync(directory), // eslint-disable-line security/detect-non-literal-fs-filename, max-len
        () => {
            const { displayProperties: { name } } = world.getClassByHash(671679327);

            expect(name).toEqual('Hunter');
        },
    );

    itif(
        'should return Night Watch',
        () => existsSync(directory), // eslint-disable-line security/detect-non-literal-fs-filename, max-len
        async () => {
            const itemName = 'Night Watch';
            const items = await world.getItemByName(itemName);

            expect(items[0].displayProperties.name).toEqual(itemName);
        },
    );

    itif(
        'should return the icon of the Agent of Nine',
        () => existsSync(directory), // eslint-disable-line security/detect-non-literal-fs-filename, max-len
        () => {
            const url = world.getVendorIcon(xurHash);

            expect(url).toBeDefined();
        },
    );

    itif(
        'should return the category hash for weapons',
        () => existsSync(directory), // eslint-disable-line security/detect-non-literal-fs-filename, max-len
        async () => {
            const { weaponCategory } = world;

            expect(weaponCategory).toEqual(1);
        },
    );
});
