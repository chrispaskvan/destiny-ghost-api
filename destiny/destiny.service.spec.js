/**
 * Destiny Service Tests
 */
const DestinyService = require('./destiny.service'),
    chance = require('chance')(),
    mockBansheeResponse = require('../mocks/bansheeResponse.json'),
    mockManifestResponse = require('../mocks/manifestResponse.json'),
    mockXurResponse = require('../mocks/xurResponse.json'),
    request = require('../helpers/request');

jest.mock('../helpers/request');

let destinyService;

beforeEach(() => {
    const cacheService = {
        getManifest: jest.fn(),
        getVendor: jest.fn(),
        setManifest: jest.fn(),
        setVendor: jest.fn()
    };

    destinyService = new DestinyService({ cacheService });
});

describe('DestinyService', () => {
    const accessToken = chance.hash();
    const characterId = chance.guid();

    describe('getFieldTestWeapons', () => {
	    beforeEach(async () => {
		    request.get.mockImplementation(() => Promise.resolve(mockBansheeResponse));
	    });

        it('should return an array of field test weapon hashes', () => {
            const { Response: { data: { vendorHash, nextRefreshDate, saleItemCategories }}} = mockBansheeResponse;
            const fieldTestWeapons = saleItemCategories.find((saleItemCategory) => {
                return saleItemCategory.categoryTitle === 'Field Test Weapons';
            });
            const itemHashes = fieldTestWeapons.saleItems.map((saleItem) => {
                const { item: { itemHash }} = saleItem;

                return itemHash;
            });

            return destinyService.getFieldTestWeapons(characterId, accessToken)
                .then(fieldTestWeapons => {
                    expect(fieldTestWeapons).toEqual({
                        vendorHash,
                        nextRefreshDate,
                        itemHashes
                    });
                });
        });
    });

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

    describe('getXur', () => {
	    beforeEach(async () => {
		    request.get.mockImplementation(() => Promise.resolve(mockXurResponse));
	    });

	    it('should return an array of exotic gear hashes', () => {
            const { Response: { data: { vendorHash, nextRefreshDate, saleItemCategories }}} = mockXurResponse;
            const exoticGear = saleItemCategories.find((saleItemCategory) => {
                return saleItemCategory.categoryTitle === 'Exotic Gear';
            });
            const itemHashes = exoticGear.saleItems.map((saleItem) => {
                const { item: { itemHash }} = saleItem;

                return itemHash;
            });

            return destinyService.getXur(accessToken)
                .then(xur => {
                    expect(xur).toEqual({
                        vendorHash,
                        nextRefreshDate,
                        itemHashes
                    });
                });
        });
    });
});
