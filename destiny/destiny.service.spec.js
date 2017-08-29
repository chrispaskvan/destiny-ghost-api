/**
 * User Service Tests
 */
'use strict';
var _ = require('underscore'),
    DestinyService = require('./destiny.service'),
    chance = require('chance')(),
    expect = require('chai').expect,
    request = require('request'),
    mockBansheeResponse = require('../mocks/bansheeResponse.json'),
    mockManifestResponse = require('../mocks/manifestResponse.json'),
    mockXurResponse = require('../mocks/xurResponse.json'),
    sinon = require('sinon');

var destinyService;

beforeEach(function () {
    var cacheService = {
        getManifest: function() {},
        getVendor: function() {},
        setManifest: function() {},
        setVendor: function() {}
    };

    sinon.stub(cacheService, 'getVendor').resolves();
    sinon.stub(cacheService, 'getManifest').resolves();

    destinyService = new DestinyService(cacheService);
});

describe('DestinyService', function () {
    const accessToken = chance.hash();
    const characterId = chance.guid();

    describe('getFieldTestWeapons', function () {
        beforeEach(function () {
            this.request = sinon.stub(request, 'get');
        });

        it('should return an array of field test weapon hashes', function () {
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
                .then(function (fieldTestWeapons) {
                    expect(fieldTestWeapons).to.eql({
                        vendorHash,
                        nextRefreshDate,
                        itemHashes
                    });
                });
        });

        afterEach(function () {
            this.request.restore();
        });
    });

    describe('getManifest', function () {
        beforeEach(function () {
            this.request = sinon.stub(request, 'get');
        });

        it('should return the latest manifest', function () {
            const { Response: manifest1 } = mockManifestResponse;

            this.request.callsArgWith(1, undefined, { statusCode: 200 }, JSON.stringify(mockManifestResponse));

            return destinyService.getManifest()
                .then(function (manifest) {
                    expect(manifest).to.eql(manifest1);
                });
        });

        afterEach(function () {
            this.request.restore();
        });
    });

    describe('getXur', function () {
        beforeEach(function () {
            this.request = sinon.stub(request, 'get');
        });

        it('should return an array of exotic gear hashes', function () {
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
                .then(function (xur) {
                    expect(xur).to.eql({
                        vendorHash,
                        nextRefreshDate,
                        itemHashes
                    });
                });
        });

        afterEach(function () {
            this.request.restore();
        });
    });
});
