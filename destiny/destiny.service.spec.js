/**
 * Destiny Service Tests
 */
const Chance = require('chance');
const request = require('../helpers/request');
const DestinyError = require('./destiny.error');
const DestinyService = require('./destiny.service');
const mockManifestResponse = require('../mocks/manifestResponse.json');

jest.mock('../helpers/request');

let destinyService;

const cacheService = {
    getManifest: jest.fn(),
    getVendor: jest.fn(),
    setManifest: jest.fn(),
    setVendor: jest.fn(),
};
const chance = new Chance();

beforeEach(() => {
    destinyService = new DestinyService({ cacheService });
});

describe('DestinyService', () => {
    beforeEach(() => {
        jest.resetAllMocks();
    });

    describe('getCharacters', () => {
        describe('when characters are returned', () => {
            it('should return an array of characters', async () => {
                const characters = [];

                request.get.mockImplementation(() => Promise.resolve({
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
                request.get.mockImplementation(() => Promise.resolve({
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

                    request.get.mockImplementation(() => Promise.resolve({
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
                    request.get.mockImplementation(() => Promise.resolve({
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

        beforeEach(() => {
            request.get.mockImplementation(() => Promise.resolve(mockManifestResponse));
        });

        describe('when manifest is cached', () => {
            it('should return the cached manifest', () => {
                cacheService.getManifest.mockImplementation(() => Promise.resolve(manifest1));

                return destinyService.getManifest()
                    .then(manifest => {
                        expect(manifest).toEqual(manifest1);
                        expect(cacheService.getManifest).toBeCalledTimes(1);
                        expect(cacheService.setManifest).not.toBeCalled();
                    });
            });
        });

        describe('when manifest is not cached', () => {
            it('should return the latest manifest', () => destinyService.getManifest()
                .then(manifest => {
                    expect(manifest).toEqual(manifest1);
                    expect(cacheService.getManifest).toBeCalledTimes(1);
                    expect(cacheService.setManifest).toBeCalledTimes(1);
                }));
        });
    });
});
