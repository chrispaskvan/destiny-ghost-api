/**
 * World Model Tests
 */
import { existsSync } from 'fs';
import {
    describe, expect,
} from 'vitest';
import World from './world';
import itif from './itif';

const directory = process.env.DESTINY_DATABASE_DIR;

describe('It\'s Bungie\'s 1st world. You\'re just querying it.', () => {
    itif(
        'should return 2 random Grimoire Cards',
        () => existsSync(directory), // eslint-disable-line security/detect-non-literal-fs-filename, max-len
        async () => {
            const count = 2;
            const world = new World({
                directory,
            });

            const cards = await world.getGrimoireCards(count);
            const [{ cardId }] = cards;

            expect(cards.length).toEqual(count);
            expect(cardId).toEqual(expect.any(Number));
        },
    );
});
