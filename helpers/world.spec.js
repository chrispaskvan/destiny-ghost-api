/**
 * World Model Tests
 */
import { existsSync } from 'fs';
import {
    beforeAll, describe, expect,
} from 'vitest';
import World from './world';
import itif from './itif';
import { postmasterHash } from '../destiny/destiny.constants';

const directory = process.env.DESTINY_DATABASE_DIR;
let world;

beforeAll(() => {
    world = new World({
        directory,
    });
});

describe('It\'s Bungie\'s 1st world. You\'re just querying it.', () => {
    itif(
        'should return 2 random Grimoire Cards',
        () => existsSync(directory), // eslint-disable-line security/detect-non-literal-fs-filename, max-len
        async () => {
            const count = 2;

            const cards = await world.getGrimoireCards(count);
            const [{ cardId }] = cards;

            expect(cards.length).toEqual(count);
            expect(cardId).toEqual(expect.any(Number));
        },
    );

    itif(
        'should return the icon of the Agent of Nine',
        () => existsSync(directory), // eslint-disable-line security/detect-non-literal-fs-filename, max-len
        async () => {
            const url = await world.getVendorIcon(postmasterHash);

            expect(url).toBeDefined();
        },
    );
});
