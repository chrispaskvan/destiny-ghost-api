import {
    beforeEach, describe, expect, it, vi,
} from 'vitest';
import Destiny2Cache from './destiny2.cache';
import mockProfileCharactersResponse from '../mocks/profileCharactersResponse.json';

let destiny2Cache;

const { Response: { characters: { data } } } = mockProfileCharactersResponse;
const characters = Object.values(data).map(character => character);
const client = {
    get: vi.fn(),
    set: vi.fn(),
};

beforeEach(() => {
    destiny2Cache = new Destiny2Cache({ client });
});

describe('Destiny2Cache', () => {
    describe('getCharacters', () => {
        describe('when characters are found', () => {
            it('should return characters', async () => {
                client.get
                    .mockImplementationOnce(() => Promise.resolve(JSON.stringify(characters)));

                const result = await destiny2Cache.getCharacters();

                expect(result).toEqual(characters);
            });
        });

        describe('when characters are not found', () => {
            it('should return characters', async () => {
                client.get.mockResolvedValueOnce(undefined);

                const result = await destiny2Cache.getCharacters();

                expect(result).toBeUndefined();
            });
        });
    });

    describe('setCharacters', () => {
        describe('when membershipId is not a string', () => {
            it('should throw an error', async () => {
                await expect(destiny2Cache.setCharacters({})).rejects.toThrowError();
            });
        });

        describe('when characters is not an array', () => {
            it('should throw an error', async () => {
                await expect(destiny2Cache.setCharacters('some-membership-id', {})).rejects.toThrowError();
            });
        });

        describe('when given a membership id and an array of characters', () => {
            it('should cache the characters using the membership id as the key', async () => {
                const membershipId = 'some-membership-id';

                await destiny2Cache
                    .setCharacters(membershipId, characters); // eslint-disable-line max-len

                expect(client.set).toHaveBeenCalledOnce();
                expect(client.set).toHaveBeenCalledWith(membershipId, JSON.stringify(characters));
            });
        });
    });
});
