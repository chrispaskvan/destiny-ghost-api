/**
 * Destiny Service Tests
 */
const DestinyService = require('./destiny.service'),
    chance = require('chance')(),
    expect = require('chai').expect,
    mockBansheeResponse = require('../mocks/bansheeResponse.json'),
    mockManifestResponse = require('../mocks/manifestResponse.json'),
    mockXurResponse = require('../mocks/xurResponse.json'),
    request = require('request'),
    sinon = require('sinon');

let destinyService;

beforeEach(() => {
    const cacheService = {
        getManifest: () => Promise.resolve(),
        getVendor: () => Promise.resolve(),
        setManifest: () => Promise.resolve(),
        setVendor: () => Promise.resolve()
    };

    destinyService = new DestinyService({ cacheService });
});

describe('DestinyService', () => {
    const accessToken = chance.hash();
    const characterId = chance.guid();

    describe('getFieldTestWeapons', () => {
        beforeEach(() => {
            this.request = sinon.stub(request, 'get');
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

            this.request.callsArgWith(1, undefined, { statusCode: 200 }, JSON.stringify(mockBansheeResponse));

            return destinyService.getFieldTestWeapons(characterId, accessToken)
                .then(fieldTestWeapons => {
                    expect(fieldTestWeapons).to.eql({
                        vendorHash,
                        nextRefreshDate,
                        itemHashes
                    });
                });
        });

        afterEach(() => this.request.restore());
    });

    describe('getManifest', () => {
        beforeEach(() => {
            this.request = sinon.stub(request, 'get');
        });

        it('should return the latest manifest', () => {
            const { Response: manifest1 } = mockManifestResponse;

            this.request.callsArgWith(1, undefined, { statusCode: 200 }, JSON.stringify(mockManifestResponse));

            return destinyService.getManifest()
                .then(manifest => {
                    expect(manifest).to.eql(manifest1);
                });
        });

        afterEach(() => this.request.restore());
    });

    describe('getXur', () => {
        beforeEach(() => {
            this.request = sinon.stub(request, 'get');
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

            this.request.callsArgWith(1, undefined, { statusCode: 200 }, JSON.stringify(mockXurResponse));

            return destinyService.getXur(accessToken)
                .then(xur => {
                    expect(xur).to.eql({
                        vendorHash,
                        nextRefreshDate,
                        itemHashes
                    });
                });
        });

        afterEach(() => this.request.restore());
    });
});
