import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getXurInventory, getXurWeapons } from './xur-inventory.js';

const WEAPON = 1;
const ARMOR = 20;
const items = {
    101: { hash: 101, itemCategoryHashes: [WEAPON], displayProperties: { name: 'Thorn' } },
    102: { hash: 102, itemCategoryHashes: [ARMOR], displayProperties: { name: 'Celestial' } },
    103: { hash: 103, displayProperties: { name: 'Exotic Engram' } },
};
const member = { membershipId: '11', membershipType: 2, accessToken: 'token' };

describe('xur inventory', () => {
    let destiny;
    let world;
    let sources;

    beforeEach(() => {
        destiny = {
            getProfile: vi.fn().mockResolvedValue([{ characterId: 'c1' }, { characterId: 'c2' }]),
            getXur: vi.fn().mockResolvedValue([101, 102, 103]),
        };
        world = {
            getItemByHash: vi.fn(async hash => items[hash]),
            getWeaponCategory: vi.fn().mockResolvedValue(WEAPON),
        };
        sources = { destiny, world };
    });

    describe('getXurInventory', () => {
        it("should ask about the member's first character", async () => {
            await getXurInventory(sources, member);

            expect(destiny.getProfile).toHaveBeenCalledWith('11', 2);
            expect(destiny.getXur).toHaveBeenCalledWith('11', 2, 'c1', 'token');
        });

        it('should ask about the character given', async () => {
            await getXurInventory(sources, { ...member, characterId: 'c2' });

            expect(destiny.getXur).toHaveBeenCalledWith('11', 2, 'c2', 'token');
        });

        it('should return every item the manifest knows', async () => {
            world.getItemByHash.mockImplementation(async hash =>
                hash === 103 ? undefined : items[hash],
            );

            await expect(getXurInventory(sources, member)).resolves.toEqual([
                items[101],
                items[102],
            ]);
        });

        it('should return an empty list when Xur sells nothing', async () => {
            destiny.getXur.mockResolvedValue([]);

            await expect(getXurInventory(sources, member)).resolves.toEqual([]);
        });

        it.each([
            ['no characters', []],
            ['no profile', undefined],
        ])('should return undefined, without asking Xur, for %s', async (_case, characters) => {
            destiny.getProfile.mockResolvedValue(characters);

            await expect(getXurInventory(sources, member)).resolves.toBeUndefined();
            expect(destiny.getXur).not.toHaveBeenCalled();
        });

        it('should let a Bungie failure through', async () => {
            const err = new Error('Xur is not here');

            destiny.getXur.mockRejectedValue(err);

            await expect(getXurInventory(sources, member)).rejects.toBe(err);
        });
    });

    describe('getXurWeapons', () => {
        it('should return only the weapons', async () => {
            await expect(getXurWeapons(sources, member)).resolves.toEqual([items[101]]);
        });

        it('should return undefined when the member has no characters', async () => {
            destiny.getProfile.mockResolvedValue([]);

            await expect(getXurWeapons(sources, member)).resolves.toBeUndefined();
            expect(world.getWeaponCategory).not.toHaveBeenCalled();
        });
    });
});
