/**
 * Destiny Service Tests
 */
const chance = require('chance')();
const request = require('../helpers/request');
const DestinyService = require('./destiny.service');
const mockManifestResponse = require('../mocks/manifestResponse.json');
const mockXurResponse = require('../mocks/xurResponse.json');

jest.mock('../helpers/request');

let destinyService;

beforeEach(() => {
    const cacheService = {
        getManifest: jest.fn(),
        getVendor: jest.fn(),
        setManifest: jest.fn(),
        setVendor: jest.fn(),
    };

    destinyService = new DestinyService({ cacheService });
});

describe('DestinyService', () => {
    const accessToken = chance.hash();

    describe('getManifest', () => {
        beforeEach(async () => {
            request.get.mockImplementation(() => Promise.resolve(mockManifestResponse));
        });

        it('should return the latest manifest', () => {
            const { Response: manifest1 } = mockManifestResponse;

            return destinyService.getManifest()
                .then(manifest => {
                    expect(manifest).toEqual(manifest1);
                });
        });
    });
});
