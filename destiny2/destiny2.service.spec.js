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
	membershipType: 2
};

let destiny2Service;

beforeEach(() => {
    const cacheService = {
        getManifest: () => {},
        getVendor: () => {},
        setManifest: () => {},
        setVendor: () => {}
    };

    sinon.stub(cacheService, 'getVendor').resolves();
    sinon.stub(cacheService, 'getManifest').resolves();

    destiny2Service = new Destiny2Service({ cacheService });
});

describe('Destiny2Service', () => {
    describe('getManifest', () => {
        beforeEach(() => {
            this.request = sinon.stub(request, 'get');
        });

        it('should return the latest manifest', () => {
            const { Response: mockManifest } = mockManifestResponse;

            this.request.callsArgWith(1, undefined, { statusCode: 200 }, JSON.stringify(mockManifestResponse));

            return destiny2Service.getManifest()
                .then(manifest => {
                    expect(manifest).to.eql(mockManifest);
                });
        });

        afterEach(() => {
            this.request.restore();
        });
    });

    describe('getProfile', () => {
		beforeEach(() => {
			this.request = sinon.stub(request, 'get');
		});

		it('should return the user\'s list of characters', () => {
			const { Response: { characters: { data }}} = mockProfileCharactersResponse;
			const mockCharacters = Object.keys(data).map(character => data[character]);

			this.request.callsArgWith(1, undefined, { statusCode: 200 }, JSON.stringify(mockProfileCharactersResponse));

			return destiny2Service.getProfile(mockUser.membershipId, mockUser.membershipType)
				.then(characters => {
					expect(characters).to.eql(mockCharacters);
				});
		});

		afterEach(() => {
			this.request.restore();
		});
	});
});
