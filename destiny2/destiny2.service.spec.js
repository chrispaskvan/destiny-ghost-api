/**
 * Destiny Service Tests
 */
const Destiny2Service = require('./destiny2.service'),
    expect = require('chai').expect,
    mockManifestResponse = require('../mocks/manifestResponse.json'),
    request = require('request'),
    sinon = require('sinon');

let destiny2Service;

beforeEach(function () {
    const cacheService = {
        getManifest: function() {},
        getVendor: function() {},
        setManifest: function() {},
        setVendor: function() {}
    };

    sinon.stub(cacheService, 'getVendor').resolves();
    sinon.stub(cacheService, 'getManifest').resolves();

    destiny2Service = new Destiny2Service(cacheService);
});

describe('Destiny2Service', function () {
    describe('getManifest', function () {
        beforeEach(function () {
            this.request = sinon.stub(request, 'get');
        });

        it('should return the latest manifest', function () {
            const { Response: manifest1 } = mockManifestResponse;

            this.request.callsArgWith(1, undefined, { statusCode: 200 }, JSON.stringify(mockManifestResponse));

            return destiny2Service.getManifest()
                .then(function (manifest) {
                    expect(manifest).to.eql(manifest1);
                });
        });

        afterEach(function () {
            this.request.restore();
        });
    });
});
