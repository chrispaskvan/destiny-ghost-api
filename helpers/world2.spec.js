/**
 * World Model Tests
 */
const fs = require('fs');
const World = require('./world2');
const itif = require('./itif');
const { xurHash } = require('../destiny2/destiny2.constants');

const directory = process.env.DESTINY2_DATABASE_DIR;

describe('It\'s Bungie\'s 2nd world. You\'re just querying it.', () => {
    itif(
        'should return the lore for Ghost Primus',
        () => fs.existsSync(directory), // eslint-disable-line security/detect-non-literal-fs-filename, max-len
        async () => {
            const world = new World({
                directory,
            });

            const { displayProperties: { name } } = await world.getLore(2505533224);

            expect(name).toEqual('Ghost Primus'); // eslint-disable-line jest/no-standalone-expect
        },
    );

    itif(
        'should return the item category Hand Cannon',
        () => fs.existsSync(directory), // eslint-disable-line security/detect-non-literal-fs-filename, max-len
        async () => {
            const world = new World({
                directory,
            });

            const { displayProperties: { name } } = await world.getItemCategory(6);

            expect(name).toEqual('Hand Cannon'); // eslint-disable-line jest/no-standalone-expect
        },
    );

    itif(
        'should return the Hunter character class',
        () => fs.existsSync(directory), // eslint-disable-line security/detect-non-literal-fs-filename, max-len
        async () => {
            const world = new World({
                directory,
            });

            const { displayProperties: { name } } = await world.getClassByHash(671679327);

            expect(name).toEqual('Hunter'); // eslint-disable-line jest/no-standalone-expect
        },
    );

    itif(
        'should return Night Watch',
        () => fs.existsSync(directory), // eslint-disable-line security/detect-non-literal-fs-filename, max-len
        async () => {
            const world = new World({
                directory,
            });

            const itemName = 'Night Watch';
            const items = await world.getItemByName(itemName);

            expect(items[0].displayProperties.name).toEqual(itemName); // eslint-disable-line jest/no-standalone-expect, max-len
        },
    );

    itif(
        'should return the icon of the Agent of Nine',
        () => fs.existsSync(directory), // eslint-disable-line security/detect-non-literal-fs-filename, max-len
        async () => {
            const world = new World({
                directory,
            });

            const url = await world.getVendorIcon(xurHash);

            expect(url).toBeDefined(); // eslint-disable-line jest/no-standalone-expect
        },
    );
});
