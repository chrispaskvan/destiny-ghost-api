import {
    beforeEach, describe, expect, it, vi,
} from 'vitest';
import Destiny2Cache, { charactersExpiration, playerStatisticsExpiration } from './destiny2.cache';
import mockProfileCharactersResponse from '../mocks/profileCharactersResponse.json';
import mockPlayerStatisticsResponse from '../mocks/playerStatisticsResponse.json';

let destiny2Cache;

const { Response: { characters: { data } } } = mockProfileCharactersResponse;
const characters = Object.values(data).map(character => character);
const {
    Response: {
        mergedAllCharacters: {
            results: {
                allPvP: playerStatistics,
            },
        },
    },
} = mockPlayerStatisticsResponse;
const client = {
    get: vi.fn(),
    setEx: vi.fn(),
};

beforeEach(() => {
    destiny2Cache = new Destiny2Cache({ client });
});

describe('Destiny2Cache', () => {
    beforeEach(() => {
        vi.resetAllMocks();
    });

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
            it('should return undefined', async () => {
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
            it('should cache the characters', async () => {
                const membershipId = 'some-membership-id';

                await destiny2Cache
                    .setCharacters(membershipId, characters);

                expect(client.setEx).toHaveBeenCalledOnce();
                expect(client.setEx).toHaveBeenCalledWith(expect.any(String), charactersExpiration, JSON.stringify(characters));
            });
        });
    });

    describe('getPlayerStatistics', () => {
        describe('when player statistics are found', () => {
            it('should return player statistics', async () => {
                client.get
                    .mockImplementationOnce(() => Promise
                        .resolve(JSON.stringify(playerStatistics)));

                const result = await destiny2Cache.getPlayerStatistics();

                expect(result).toEqual(playerStatistics);
            });
        });

        describe('when player statistics are not found', () => {
            it('should return undefined', async () => {
                client.get.mockResolvedValueOnce(undefined);

                const result = await destiny2Cache.getPlayerStatistics();

                expect(result).toBeUndefined();
            });
        });
    });

    describe('setPlayerStatistics', () => {
        describe('when membershipId is not a string', () => {
            it('should throw an error', async () => {
                await expect(destiny2Cache.setPlayerStatistics({})).rejects.toThrowError();
            });
        });

        describe('when player statistics is an empty object', () => {
            it('should throw an error', async () => {
                await expect(destiny2Cache.setPlayerStatistics('some-membership-id', {})).rejects.toThrowError();
            });
        });

        describe('when given a membership id and an object of player statistics', () => {
            it('should cache the player statistics', async () => {
                const membershipId = 'some-membership-id';

                await destiny2Cache
                    .setPlayerStatistics(membershipId, playerStatistics);

                expect(client.setEx).toHaveBeenCalledOnce();
                expect(client.setEx).toHaveBeenCalledWith(expect.any(String), playerStatisticsExpiration, JSON.stringify(playerStatistics));
            });
        });
    });
});
