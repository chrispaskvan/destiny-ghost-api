/**
 * World Model Tests
 */
import { existsSync } from 'fs';
import {
    beforeAll, describe, expect, it,
} from 'vitest';
import World from './world';
import itif from './itif';
import { postmasterHash } from '../destiny/destiny.constants';
import pool from './pool';

const directory = process.env.DESTINY_DATABASE_DIR;
let world;

beforeAll(async () => {
    world = new World({
        directory,
        pool,
    });

    await world.bootstrapped;
});

describe('It\'s Bungie\'s 1st world. You\'re just querying it.', () => {
    itif(
        'should return 2 random Grimoire Cards',
        () => existsSync(directory),
        async () => {
            const count = 2;

            const cards = await world.getGrimoireCards(count);
            const [{ cardId }] = cards;

            expect(cards.length).toEqual(count);
            expect(cardId).toEqual(expect.any(Number));
        },
    );

    describe('if the numberOfCards is not a number', () => {
        it('should throw an error', async () => {
            const numberOfCards = 'foo';

            await expect(world.getGrimoireCards(numberOfCards)).rejects.toThrow('numberOfCards must be a number');
        });
    });

    itif(
        'should return the icon of the Agent of Nine',
        () => existsSync(directory),
        async () => {
            const url = await world.getVendorIcon(postmasterHash);

            expect(url).toBeDefined();
        },
    );
});
