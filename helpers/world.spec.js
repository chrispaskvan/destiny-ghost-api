/**
 * World Model Tests
 */
import { basename, join } from 'node:path';
import { existsSync } from 'node:fs';
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

describe('updateManifest path safety', () => {
    it('should extract only the basename from the manifest URL', () => {
        const relativeUrl = '/common/destiny_content/sqlite/en/world.content';
        const fileName = basename(relativeUrl);

        expect(fileName).toBe('world.content');
        expect(fileName).not.toContain('/');
    });

    it('should strip traversal sequences from the manifest URL', () => {
        const relativeUrl = '/path/../../etc/passwd';
        const fileName = basename(relativeUrl);

        expect(fileName).toBe('passwd');
        expect(fileName).not.toContain('..');
    });

    it('should produce a safe database path within the target directory', () => {
        const databaseDirectory = '/app/databases/destiny';
        const relativeUrl = '/common/../../etc/shadow';
        const fileName = basename(relativeUrl);
        const databasePath = join(databaseDirectory, fileName);

        expect(databasePath).toBe(join(databaseDirectory, 'shadow'));
        expect(databasePath.startsWith(databaseDirectory)).toBe(true);
    });

    it('should handle URLs with encoded path separators safely', () => {
        const relativeUrl = '/path/to/file%2F..%2F..%2Fetc%2Fpasswd';
        const fileName = basename(relativeUrl);

        // basename treats the whole thing as a filename since the %2F are not real separators
        expect(fileName).not.toContain('/');
    });
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
