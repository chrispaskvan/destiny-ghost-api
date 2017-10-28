/**
 * World Model Tests
 */
const Ghost = require('../ghost/ghost'),
	World = require('./world2'),
	expect = require('chai').expect,
	mockManifest = require('../mocks/manifest2Response').Response;

const mockDestinyService = {
	getManifest: () =>  Promise.resolve(mockManifest)
};

const world = new World();

describe('It\'s Bungie\'s 2nd world. You\'re just querying it.', function () {
	let ghost;

	beforeEach(function () {
		ghost = new Ghost({
			destinyService: mockDestinyService
		});
	});

	it('should return the Hunter character class', function (done) {
		ghost.getWorldDatabasePath()
			.then(path => {
				world.open(path);
				world.getLore(2505533224)
					.then(lore => {
						const { displayProperties: { name }} = lore;

						expect(name).to.equal('Ghost Primus');
						world.close();
						done();
					})
					.catch(err => {
						world.close();
						done(err)
					});
			});
	});
});
