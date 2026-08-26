/**
 * Destiny Service Tests
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import Chance from 'chance';
import { get } from '../helpers/bungie.request.js';
import DestinyError from './destiny.error.js';
import DestinyService from './destiny.service.js';
import mockManifestResponse from '../mocks/manifestResponse.json';

vi.mock('../helpers/bungie.request.js');

let destinyService;

const cacheService = {
    getManifest: vi.fn(),
    getVendor: vi.fn(),
    setManifest: vi.fn(),
    setVendor: vi.fn(),
};
const chance = new Chance();

beforeEach(() => {
    destinyService = new DestinyService({ cacheService });
});

describe('DestinyService', () => {
    beforeEach(() => {
        vi.resetAllMocks();
    });

    describe('getCharacters', () => {
        describe('when characters are returned', () => {
            it('should return an array of characters', async () => {
                const characters = [];

                get.mockImplementation(() =>
                    Promise.resolve({
                        ErrorCode: 1,
                        Response: {
                            data: {
                                characters,
                            },
                        },
                    }),
                );

                const result = await destinyService.getCharacters();

                expect(result).toEqual(characters);
            });
        });

        describe('when an error response is returned', () => {
            it('should throw', async () => {
                get.mockImplementation(() =>
                    Promise.resolve({
                        ErrorCode: 2,
                    }),
                );

                await expect(destinyService.getCharacters()).rejects.toThrow(DestinyError);
            });
        });
    });

    describe('getCurrentUser', () => {
        describe('when current user is defined', () => {
            describe('when displayName and membershipId exist', () => {
                it('should return the current user', async () => {
                    const accessToken = chance.hash();
                    const displayName = chance.word();
                    const membershipId = '2';
                    const membershipType = 2;
                    const profilePicturePath = '/img/profile/avatars/Destiny26.jpg';

                    get.mockImplementation(() =>
                        Promise.resolve({
                            ErrorCode: 1,
                            Response: {
                                destinyMemberships: [
                                    {
                                        crossSaveOverride: membershipType,
                                        displayName,
                                        membershipId,
                                        membershipType,
                                    },
                                ],
                                bungieNetUser: {
                                    profilePicturePath,
                                },
                            },
                        }),
                    );

                    const currentUser = await destinyService.getCurrentUser(accessToken);

                    expect(currentUser).toEqual({
                        displayName,
                        membershipId,
                        membershipType,
                        profilePicturePath,
                    });
                    expect(get).toHaveBeenCalledWith(
                        expect.objectContaining({
                            headers: expect.objectContaining({
                                authorization: `Bearer ${accessToken}`,
                            }),
                        }),
                    );
                });
            });

            describe('when ErrorCode is not 1', () => {
                it('should throw carrying the error details from the response', async () => {
                    get.mockImplementation(() =>
                        Promise.resolve({
                            ErrorCode: 0,
                            ErrorStatus: 'Failed',
                            Message: 'Ok',
                            Response: {
                                destinyMemberships: [],
                            },
                        }),
                    );

                    await expect(
                        destinyService.getCurrentUser(chance.hash()),
                    ).rejects.toMatchObject({
                        code: 0,
                        message: 'Ok',
                        status: 'Failed',
                    });
                });
            });
        });
    });

    describe('getManifest', () => {
        const { Response: manifest1 } = mockManifestResponse;
        const lastModified = 'Mon,11 Sep 2023 02:13:47 GMT';
        const maxAge = 90;

        beforeEach(() => {
            get.mockImplementation(() =>
                Promise.resolve({
                    data: mockManifestResponse,
                    headers: {
                        'cache-control': `public, max-age=${maxAge}`,
                        'last-modified': lastModified,
                    },
                }),
            );
        });

        describe('when manifest is cached', () => {
            it('should return the cached manifest', () => {
                const result1 = {
                    data: {
                        manifest: manifest1,
                    },
                    meta: {
                        lastModified,
                        maxAge,
                        wasCached: true,
                    },
                };

                cacheService.getManifest.mockImplementation(() => Promise.resolve(result1));

                return destinyService.getManifest().then(result => {
                    expect(result).toEqual(result1);
                    expect(cacheService.getManifest).toBeCalledTimes(1);
                    expect(cacheService.setManifest).not.toBeCalled();
                });
            });
        });

        describe('when manifest is not cached', () => {
            it('should return the latest manifest', () => {
                const result1 = {
                    data: {
                        manifest: manifest1,
                    },
                    meta: {
                        lastModified,
                        maxAge,
                    },
                };

                return destinyService.getManifest().then(result => {
                    expect(result).toEqual(result1);
                    expect(result.meta.wasCached).toBeFalsy();
                    expect(cacheService.getManifest).toBeCalledTimes(1);
                    expect(cacheService.setManifest).toBeCalledTimes(1);
                });
            });

            describe('when the response omits a usable cache-control max-age', () => {
                it.each([
                    ['the header is missing', undefined],
                    ['the header has no max-age directive', 'public'],
                ])('should return the manifest uncached when %s', (_, cacheControl) => {
                    get.mockImplementation(() =>
                        Promise.resolve({
                            data: mockManifestResponse,
                            headers: {
                                ...(cacheControl ? { 'cache-control': cacheControl } : {}),
                                'last-modified': lastModified,
                            },
                        }),
                    );

                    return destinyService.getManifest().then(result => {
                        expect(result.data.manifest).toEqual(manifest1);
                        expect(result.meta.maxAge).toBe(0);
                        // A zero TTL would make Redis SETEX fail on every fetch.
                        expect(cacheService.setManifest).not.toBeCalled();
                    });
                });
            });
        });
    });
});
