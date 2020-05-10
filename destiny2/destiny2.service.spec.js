/**
 * Destiny Service Tests
 */
const Destiny2Service = require('./destiny2.service');
const DestinyError = require('../destiny/destiny.error');
const mockManifestResponse = require('../mocks/manifestResponse.json');
const mockProfileCharactersResponse = require('../mocks/profileCharactersResponse.json');
const mockXurResponse = require('../mocks/xurResponse.json');
const request = require('../helpers/request');

jest.mock('../helpers/request');

const mockUser = {
    membershipId: '11',
    membershipType: 2,
};

const cacheService = {
    getCharacters: jest.fn(),
    getManifest: jest.fn(),
    getVendor: jest.fn(),
    setCharacters: jest.fn(),
    setManifest: jest.fn(),
    setVendor: jest.fn(),
};

let destiny2Service;

beforeEach(() => {
    destiny2Service = new Destiny2Service({ cacheService });
});

describe('Destiny2Service', () => {
    beforeEach(() => {
        jest.resetAllMocks();
    });

    describe('getManifest', () => {
        describe('when ErrorCode equals 1', () => {
            it('should return the latest manifest', async () => {
                request.get.mockImplementation(() => Promise.resolve(mockManifestResponse));

                const { Response: mockManifest } = mockManifestResponse;
                const manifest = await destiny2Service.getManifest();

                expect(manifest).toEqual(mockManifest);
            });
        });

        describe('when ErrorCode does not equal 1', () => {
            it('should throw', async () => {
                request.get.mockImplementation(() => Promise.resolve({
                    ErrorCode: 0,
                    Message: 'Ok',
                    Response: {},
                    Status: 'Failed',
                }));

                await expect(destiny2Service.getManifest()).rejects.toThrow(DestinyError);
            });
        });
    });

    describe('getProfile', () => {
        describe('when characters are cached', () => {
            it('should return the cached characters', async () => {
                const { Response: { characters: { data } } } = mockProfileCharactersResponse;
                const mockCharacters = Object.values(data).map(character => character);

                cacheService.getCharacters
                    .mockImplementation(() => Promise.resolve(mockCharacters));

                const characters = await destiny2Service
                    .getProfile(mockUser.membershipId, mockUser.membershipType);

                expect(characters).toEqual(mockCharacters);
                expect(request.get).not.toHaveBeenCalled();
            });
        });

        describe('when ErrorCode equals 1', () => {
            it('should return the user\'s list of characters', async () => {
                request.get.mockImplementation(() => Promise
                    .resolve(mockProfileCharactersResponse));

                const { Response: { characters: { data } } } = mockProfileCharactersResponse;
                const mockCharacters = Object.values(data).map(character => character);
                const characters = await destiny2Service
                    .getProfile(mockUser.membershipId, mockUser.membershipType);

                expect(characters).toEqual(mockCharacters);
            });
        });

        describe('when ErrorCode does not equal 1', () => {
            it('should return the latest manifest', async () => {
                request.get.mockImplementation(() => Promise.resolve({
                    ErrorCode: 0,
                    Message: 'Ok',
                    Response: {},
                    Status: 'Failed',
                }));

                await expect(destiny2Service
                    .getProfile(mockUser.membershipId, mockUser.membershipType))
                    .rejects.toThrow(DestinyError);
            });
        });
    });

    describe('getXur', () => {
        describe('when vendor is cached', () => {
            it('should return the xur\'s inventory', async () => {
                const { Response: { sales: { data } } } = mockXurResponse;
                const itemHashes = Object.entries(data).map(([, value]) => value.itemHash);

                cacheService.getVendor.mockImplementation(() => itemHashes);

                const items = await destiny2Service
                    .getXur(mockUser.membershipId, mockUser.membershipType);

                expect(items).toEqual(itemHashes);
                expect(request.get).not.toHaveBeenCalled();
                expect(cacheService.setVendor).not.toHaveBeenCalled();
            });
        });

        describe('when vendor is not cached', () => {
            describe('when ErrorCode equals 1', () => {
                it('should return the xur\'s inventory', async () => {
                    cacheService.getVendor.mockImplementation(() => undefined);
                    request.get.mockImplementation(() => Promise
                        .resolve(mockXurResponse));

                    const { Response: { sales: { data } } } = mockXurResponse;
                    const itemHashes = Object.entries(data).map(([, value]) => value.itemHash);
                    const items = await destiny2Service
                        .getXur(mockUser.membershipId, mockUser.membershipType);

                    expect(items).toEqual(itemHashes);
                    expect(cacheService.setVendor).toHaveBeenCalled();
                });
            });
        });

        describe('when ErrorCode does not equal 1', () => {
            it('should return the latest manifest', async () => {
                request.get.mockImplementation(() => Promise.resolve({
                    ErrorCode: 0,
                    Message: 'Ok',
                    Response: {},
                    Status: 'Failed',
                }));

                await expect(destiny2Service
                    .getXur(mockUser.membershipId, mockUser.membershipType, 'some-character-id', 'some-access-token'))
                    .rejects.toThrow(DestinyError);
            });
        });
    });
});
