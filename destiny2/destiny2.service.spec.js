/**
 * Destiny Service Tests
 */
const Destiny2Service = require('./destiny2.service'),
    expect = require('chai').expect,
    mockManifestResponse = require('../mocks/manifestResponse.json'),
	mockProfileCharactersResponse = require('../mocks/profileCharactersResponse.json'),
    request = require('request'),
    sinon = require('sinon');

const mockUser = {
	membershipId: '11',
	membershipType: 2,
};

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

    destiny2Service = new Destiny2Service({ cacheService });
});

describe('Destiny2Service', function () {
    describe('getManifest', function () {
        beforeEach(function () {
            this.request = sinon.stub(request, 'get');
        });

        it('should return the latest manifest', function () {
            const { Response: mockManifest } = mockManifestResponse;

            this.request.callsArgWith(1, undefined, { statusCode: 200 }, JSON.stringify(mockManifestResponse));

            return destiny2Service.getManifest()
                .then(function (manifest) {
                    expect(manifest).to.eql(mockManifest);
                });
        });

        afterEach(function () {
            this.request.restore();
        });
    });

    describe('getProfile', function () {
		beforeEach(function () {
			this.request = sinon.stub(request, 'get');
		});

		it('should return the user\'s list of characters', function () {
			const { Response: { characters: { data }}} = mockProfileCharactersResponse;
			const mockCharacters = Object.keys(data).map(character => data[character]);

			this.request.callsArgWith(1, undefined, { statusCode: 200 }, JSON.stringify(mockProfileCharactersResponse));

			return destiny2Service.getProfile(mockUser.membershipId, mockUser.membershipType)
				.then(function (characters) {
					expect(characters).to.eql(mockCharacters);
				});
		});

		afterEach(function () {
			this.request.restore();
		});
	});
});
