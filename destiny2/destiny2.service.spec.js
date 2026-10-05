/**
 * Destiny Service Tests
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import Destiny2Service from './destiny2.service.js';
import DestinyError from '../destiny/destiny.error.js';
import mockManifestResponse from '../mocks/manifestResponse.json';
import mockProfileCharactersResponse from '../mocks/profileCharactersResponse.json';
import mockPlayerStatisticsResponse from '../mocks/playerStatisticsResponse.json';
import mockXurResponse from '../mocks/xurResponse.json';
import { get, post } from '../helpers/bungie.request.js';
import configuration from '../helpers/config.js';
import { strangeGearOffersHash } from './destiny2.constants.js';

vi.mock('../helpers/bungie.request.js');

const mockUser = {
    membershipId: '11',
    membershipType: 2,
};

const cacheService = {
    getCharacters: vi.fn(),
    getManifest: vi.fn(),
    getPlayerStatistics: vi.fn(),
    getVendor: vi.fn(),
    setCharacters: vi.fn(),
    setManifest: vi.fn(),
    setPlayerStatistics: vi.fn(),
    setVendor: vi.fn(),
};

let destiny2Service;

beforeEach(() => {
    destiny2Service = new Destiny2Service({ cacheService });
});

describe('Destiny2Service', () => {
    beforeEach(() => {
        vi.resetAllMocks();
    });

    /**
     * Bungie redirects an API path without a trailing slash to one with it, and
     * Destiny 1 paths under /platform to /d1/platform by way of plain HTTP - which
     * fetch follows, sending the API key unencrypted. Each request has to be for
     * the URL Bungie actually serves.
     */
    describe('Bungie URLs', () => {
        const { host } = configuration.bungie;

        it.each([
            [
                'getManifest',
                () => destiny2Service.getManifest(true),
                `${host}/Platform/Destiny2/Manifest/`,
            ],
            [
                'getPlayerStatistics',
                () => destiny2Service.getPlayerStatistics('11', 2),
                `${host}/Platform/Destiny2/2/Account/11/Stats/`,
            ],
            [
                'getProfile',
                () => destiny2Service.getProfile('11', 2, true),
                `${host}/Platform/Destiny2/2/Profile/11/?components=Characters`,
            ],
            [
                'getXur',
                () => destiny2Service.getXur('11', 2, '22'),
                `${host}/Platform/Destiny2/2/Profile/11/Character/22/Vendors/${strangeGearOffersHash}/?components=402`,
            ],
        ])('%s should request the URL Bungie serves', async (_name, request, url) => {
            get.mockResolvedValue({ ErrorCode: 2 });

            await request().catch(() => undefined);

            expect(get.mock.calls[0][0].url).toEqual(url);
        });
    });

    describe('findPlayers', () => {
        describe('when ErrorCode equals 1', () => {
            it('should return the search results', async () => {
                const displayName = 'some-display-name';
                const pageNumber = 1;
                const responseBody = {
                    ErrorCode: 1,
                    Response: {
                        searchResults: [
                            {
                                displayName,
                                membershipId: 'some-membership-id',
                                membershipType: 2,
                            },
                        ],
                    },
                };

                post.mockImplementationOnce(() => Promise.resolve(responseBody));

                const players = await Destiny2Service.findPlayers(displayName, pageNumber);

                expect(players).toEqual(responseBody.Response.searchResults);
            });
        });

        describe('when ErrorCode does not equal 1', () => {
            it('should throw', async () => {
                const responseBody = {
                    ErrorCode: 0,
                    Message: 'Ok',
                    Response: {},
                    Status: 'Failed',
                };

                post.mockImplementationOnce(() => Promise.resolve(responseBody));

                await expect(Destiny2Service.findPlayers('some-display-name', 1)).rejects.toThrow(
                    DestinyError,
                );
            });
        });
    });

    describe('getManifest', () => {
        const lastModified = 'Mon,11 Sep 2023 02:13:47 GMT';
        const maxAge = 90;
        const headers = {
            'cache-control': `public, max-age=${maxAge}`,
            'last-modified': lastModified,
        };

        describe('when ErrorCode equals 1', () => {
            it('should return the latest manifest', async () => {
                const { Response: manifest1 } = mockManifestResponse;
                const result1 = {
                    data: {
                        manifest: manifest1,
                    },
                    meta: {
                        lastModified,
                        maxAge,
                    },
                };

                get.mockImplementation(() =>
                    Promise.resolve({
                        data: mockManifestResponse,
                        headers,
                    }),
                );

                const result = await destiny2Service.getManifest();

                expect(result).toEqual(result1);
            });
        });

        describe('when ErrorCode does not equal 1', () => {
            it('should throw', async () => {
                get.mockImplementation(() =>
                    Promise.resolve({
                        data: {
                            ErrorCode: 0,
                            Message: 'Ok',
                            Response: {},
                            Status: 'Failed',
                        },
                        headers,
                    }),
                );

                await expect(destiny2Service.getManifest()).rejects.toThrow(DestinyError);
            });
        });
    });

    describe('getPlayerStatistics', () => {
        describe('when ErrorCode equals 1', () => {
            const allPvP =
                mockPlayerStatisticsResponse.Response?.mergedAllCharacters?.results?.allPvP;
            const {
                allTime: {
                    combatRating: {
                        basic: { displayValue: combatRating },
                    },
                    efficiency: {
                        basic: { displayValue: efficiency },
                    },
                    highestLightLevel: {
                        basic: { displayValue: highestLightLevel },
                    },
                    killsDeathsAssists: {
                        basic: { displayValue: kda },
                    },
                    killsDeathsRatio: {
                        basic: { displayValue: kdr },
                    },
                },
            } = allPvP;
            const playerStatistics = {
                pvp: {
                    combatRating,
                    efficiency,
                    highestLightLevel,
                    kda,
                    kdr,
                },
            };

            describe('when player statistics are not cached', () => {
                it("should return the player's statistics", async () => {
                    cacheService.getPlayerStatistics.mockImplementationOnce(() =>
                        Promise.resolve(),
                    );

                    get.mockImplementationOnce(() => Promise.resolve(mockPlayerStatisticsResponse));

                    const result = await destiny2Service.getPlayerStatistics(
                        mockUser.membershipId,
                        mockUser.membershipType,
                    );

                    expect(result).toEqual(playerStatistics);
                    expect(get).toHaveBeenCalledOnce();
                    expect(cacheService.setPlayerStatistics).toHaveBeenCalledWith(
                        mockUser.membershipId,
                        playerStatistics,
                    );
                });
            });

            describe('when player statistics are cached', () => {
                it("should return the cached player's statistics", async () => {
                    cacheService.getPlayerStatistics.mockImplementationOnce(() =>
                        Promise.resolve(playerStatistics),
                    );

                    get.mockImplementationOnce(() => Promise.resolve(mockPlayerStatisticsResponse));

                    const result = await destiny2Service.getPlayerStatistics(
                        mockUser.membershipId,
                        mockUser.membershipType,
                    );

                    expect(result).toEqual(playerStatistics);
                    expect(get).not.toHaveBeenCalled();
                    expect(cacheService.setPlayerStatistics).not.toHaveBeenCalled();
                });
            });
        });

        describe('when ErrorCode does not equal 1', () => {
            it('should return the latest manifest', async () => {
                get.mockImplementation(() =>
                    Promise.resolve({
                        ErrorCode: 0,
                        Message: 'Ok',
                        Response: {},
                        Status: 'Failed',
                    }),
                );

                await expect(
                    destiny2Service.getPlayerStatistics(
                        mockUser.membershipId,
                        mockUser.membershipType,
                    ),
                ).rejects.toThrow(DestinyError);
            });
        });
    });

    describe('getProfile', () => {
        describe('when characters are cached', () => {
            it('should return the cached characters', async () => {
                const {
                    Response: {
                        characters: { data },
                    },
                } = mockProfileCharactersResponse;
                const mockCharacters = Object.values(data).map(character => character);

                cacheService.getCharacters.mockImplementation(() =>
                    Promise.resolve(mockCharacters),
                );

                const characters = await destiny2Service.getProfile(
                    mockUser.membershipId,
                    mockUser.membershipType,
                );

                expect(characters).toEqual(mockCharacters);
                expect(get).not.toHaveBeenCalled();
            });
        });

        describe('when ErrorCode equals 1', () => {
            it("should return the user's list of characters", async () => {
                get.mockImplementation(() => Promise.resolve(mockProfileCharactersResponse));

                const {
                    Response: {
                        characters: { data },
                    },
                } = mockProfileCharactersResponse;
                const mockCharacters = Object.values(data).map(character => character);
                const characters = await destiny2Service.getProfile(
                    mockUser.membershipId,
                    mockUser.membershipType,
                );

                expect(characters).toEqual(mockCharacters);
            });
        });

        describe('when ErrorCode does not equal 1', () => {
            it('should return the latest manifest', async () => {
                get.mockImplementation(() =>
                    Promise.resolve({
                        ErrorCode: 0,
                        Message: 'Ok',
                        Response: {},
                        Status: 'Failed',
                    }),
                );

                await expect(
                    destiny2Service.getProfile(mockUser.membershipId, mockUser.membershipType),
                ).rejects.toThrow(DestinyError);
            });
        });
    });

    describe('getXur', () => {
        describe('when vendor is cached', () => {
            it("should return the xur's inventory", async () => {
                const {
                    Response: {
                        sales: { data },
                    },
                } = mockXurResponse;
                const itemHashes = Object.entries(data).map(([, value]) => value.itemHash);

                cacheService.getVendor.mockImplementation(() => itemHashes);

                const items = await destiny2Service.getXur(
                    mockUser.membershipId,
                    mockUser.membershipType,
                );

                expect(items).toEqual(itemHashes);
                expect(get).not.toHaveBeenCalled();
                expect(cacheService.setVendor).not.toHaveBeenCalled();
            });
        });

        describe('when vendor is not cached', () => {
            describe('when ErrorCode equals 1', () => {
                it("should return the xur's inventory", async () => {
                    cacheService.getVendor.mockImplementation(() => undefined);
                    get.mockImplementation(() => Promise.resolve(mockXurResponse));

                    const {
                        Response: {
                            sales: { data },
                        },
                    } = mockXurResponse;
                    const itemHashes = Object.entries(data).map(([, value]) => value.itemHash);
                    const items = await destiny2Service.getXur(
                        mockUser.membershipId,
                        mockUser.membershipType,
                    );

                    expect(items).toEqual(itemHashes);
                    expect(cacheService.setVendor).toHaveBeenCalled();
                });
            });
        });

        describe('when ErrorCode does not equal 1', () => {
            it('should return the latest manifest', async () => {
                get.mockImplementation(() =>
                    Promise.resolve({
                        ErrorCode: 0,
                        Message: 'Ok',
                        Response: {},
                        Status: 'Failed',
                    }),
                );

                await expect(
                    destiny2Service.getXur(
                        mockUser.membershipId,
                        mockUser.membershipType,
                        'some-character-id',
                        'some-access-token',
                    ),
                ).rejects.toThrow(DestinyError);
            });
        });
    });
});
