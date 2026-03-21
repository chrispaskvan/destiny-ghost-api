/**
 * World Model Tests
 */
import { existsSync } from 'node:fs';
import {
    afterEach, beforeAll, describe, expect, it, vi,
} from 'vitest';
import World from './world.js';
import itif from './itif.js';
import { postmasterHash } from '../destiny/destiny.constants.js';
import pool from './pool.js';

vi.mock('node:fs', async importOriginal => {
    const actual = await importOriginal();
    return {
        ...actual,
        existsSync: vi.fn(actual.existsSync),
    };
});

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
    afterEach(() => {
        vi.mocked(existsSync).mockClear();
    });

    it('should resolve a safe database path from a normal manifest URL', async () => {
        const w = new World({ pool });
        w.directory = '/app/databases/destiny';
        const manifest = {
            mobileWorldContentPaths: {
                en: '/common/destiny_content/sqlite/en/world.content',
            },
        };

        vi.mocked(existsSync).mockReturnValue(true);

        const result = await w.updateManifest(manifest);

        expect(result).toEqual(manifest);
    });

    it('should reject manifest URLs that resolve to . or ..', async () => {
        const w = new World({ pool });
        w.directory = '/app/databases/destiny';

        await expect(w.updateManifest({
            mobileWorldContentPaths: { en: '/path/to/..' },
        })).rejects.toThrow('Invalid manifest path');

        await expect(w.updateManifest({
            mobileWorldContentPaths: { en: '.' },
        })).rejects.toThrow('Invalid manifest path');
    });

    it('should reject manifest with empty relative URL', async () => {
        const w = new World({ pool });
        w.directory = '/app/databases/destiny';

        await expect(w.updateManifest({
            mobileWorldContentPaths: { en: '' },
        })).rejects.toThrow('Invalid manifest path');
    });

    it('should reject manifest with undefined relative URL', async () => {
        const w = new World({ pool });
        w.directory = '/app/databases/destiny';

        await expect(w.updateManifest({
            mobileWorldContentPaths: { en: undefined },
        })).rejects.toThrow('Invalid manifest path');
    });

    it('should use only the basename when URL contains traversal', async () => {
        const w = new World({ pool });
        w.directory = '/app/databases/destiny';
        const manifest = {
            mobileWorldContentPaths: {
                en: '/path/../../etc/passwd',
            },
        };

        vi.mocked(existsSync).mockReturnValue(true);

        const result = await w.updateManifest(manifest);

        expect(result).toEqual(manifest);
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

        it('should throw for NaN', async () => {
            await expect(world.getGrimoireCards(NaN)).rejects.toThrow('numberOfCards must be a number');
        });

        it('should throw for Infinity', async () => {
            await expect(world.getGrimoireCards(Infinity)).rejects.toThrow('numberOfCards must be a number');
        });
    });

    describe('if numberOfCards is zero or negative', () => {
        it('should return an empty array for 0', async () => {
            const cards = await world.getGrimoireCards(0);

            expect(cards).toEqual([]);
        });

        it('should return an empty array for negative numbers', async () => {
            const cards = await world.getGrimoireCards(-5);

            expect(cards).toEqual([]);
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
