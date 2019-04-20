/**
 * Destiny Service Tests
 */
const Destiny2Service = require('./destiny2.service'),
    mockManifestResponse = require('../mocks/manifestResponse.json'),
	mockProfileCharactersResponse = require('../mocks/profileCharactersResponse.json'),
	request = require('../helpers/request');

jest.mock('../helpers/request');

const mockUser = {
	membershipId: '11',
	membershipType: 2
};

const cacheService = {
	getManifest: jest.fn(),
	setManifest: jest.fn()
};

let destiny2Service;

beforeEach(() => {
    destiny2Service = new Destiny2Service({ cacheService });
});

describe('Destiny2Service', () => {
    describe('getManifest', () => {
	    beforeEach(async () => {
		    request.get.mockImplementation(() => Promise.resolve(mockManifestResponse));
	    });

        it('should return the latest manifest', async () => {
            const { Response: mockManifest } = mockManifestResponse;
            const manifest = await destiny2Service.getManifest();

            expect(manifest).toEqual(mockManifest);
        });
    });

    describe('getProfile', () => {
	    beforeEach(async () => {
		    request.get.mockImplementation(() => Promise.resolve(mockProfileCharactersResponse));
	    });

	    it('should return the user\'s list of characters', async () => {
			const { Response: { characters: { data }}} = mockProfileCharactersResponse;
			const mockCharacters = Object.keys(data).map(character => data[character]);
			const characters = await destiny2Service.getProfile(mockUser.membershipId, mockUser.membershipType);

			expect(characters).toEqual(mockCharacters);
		});
	});
});
