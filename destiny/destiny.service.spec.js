/**
 * Destiny Service Tests
 */
import {
    beforeEach, describe, expect, it, vi,
} from 'vitest';
import Chance from 'chance';
import { get } from '../helpers/request';
import DestinyError from './destiny.error';
import DestinyService from './destiny.service';
import mockManifestResponse from '../mocks/manifestResponse.json';

vi.mock('../helpers/request');

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

describe.concurrent('DestinyService', () => {
    beforeEach(() => {
        vi.resetAllMocks();
    });

    describe('getCharacters', () => {
        describe('when characters are returned', () => {
            it('should return an array of characters', async () => {
                const characters = [];

                get.mockImplementation(() => Promise.resolve({
                    ErrorCode: 1,
                    Response: {
                        data: {
                            characters,
                        },
                    },
                }));

                const result = await destinyService.getCharacters();

                expect(result).toEqual(characters);
            });
        });

        describe('when an error response is returned', () => {
            it('should throw', async () => {
                get.mockImplementation(() => Promise.resolve({
                    ErrorCode: 2,
                }));

                await expect(destinyService.getCharacters()).rejects.toThrow(DestinyError);
            });
        });
    });

    describe('getCurrentUser', () => {
        describe('when current user is defined', () => {
            describe('when displayName and membershipId exist', () => {
                it('should return the current user', async () => {
                    const displayName = chance.word();
                    const membershipId = '2';
                    const membershipType = 2;
                    const profilePicturePath = '/img/profile/avatars/Destiny26.jpg';

                    get.mockImplementation(() => Promise.resolve({
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
                    }));

                    const currentUser = await destinyService.getCurrentUser();

                    expect(currentUser).toEqual({
                        displayName,
                        membershipId,
                        membershipType,
                        profilePicturePath,
                    });
                });
            });

            describe('when ErrorCode is not 1', () => {
                it('should throw', async () => {
                    get.mockImplementation(() => Promise.resolve({
                        ErrorCode: 0,
                        Message: 'Ok',
                        Response: {
                            destinyMemberships: [],
                        },
                        Status: 'Failed',
                    }));

                    await expect(destinyService.getCurrentUser()).rejects.toThrow(DestinyError);
                });
            });
        });
    });

    describe('getManifest', () => {
        const { Response: manifest1 } = mockManifestResponse;
        const lastModified = 'Mon,11 Sep 2023 02:13:47 GMT';
        const maxAge = 90;

        beforeEach(() => {
            get.mockImplementation(() => Promise.resolve({
                data: mockManifestResponse,
                headers: {
                    'cache-control': `public, max-age=${maxAge}`,
                    'last-modified': lastModified,
                },
            }));
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

                return destinyService.getManifest()
                    .then(result => {
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

                return destinyService.getManifest()
                    .then(result => {
                        expect(result).toEqual(result1);
                        expect(result.meta.wasCached).toBeFalsy();
                        expect(cacheService.getManifest).toBeCalledTimes(1);
                        expect(cacheService.setManifest).toBeCalledTimes(1);
                    });
            });
        });
    });
});
