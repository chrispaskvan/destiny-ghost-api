/**
 * World Model Tests
 */
const Ghost = require('./ghost'),
	World = require('./world2'),
	expect = require('chai').expect,
	mockManifest = require('../mocks/manifest2Response').Response;

const mockDestinyService = {
	getManifest: () =>  Promise.resolve(mockManifest)
};

const world = new World();

describe('It\'s Bungie\'s 2nd world. You\'re just querying it.', () => {
	let ghost;

	beforeEach(() => {
		ghost = new Ghost({
			destinyService: mockDestinyService
		});

		ghost.updateManifest = (manifest) => Promise.resolve(manifest);
	});

	it('should return the lore for Ghost Primus', (done) => {
		ghost.getWorldDatabasePath()
			.then(path => {
				return world.open(path)
					.then(() => world.getLore(2505533224))
					.then(lore => {
						const { displayProperties: { name }} = lore;

						expect(name).to.equal('Ghost Primus');
						world.close();
						done();
					});
			})
			.catch(err => {
				world.close();
				done(err);
			});
	});

	it('should return the item category Hand Cannon', (done) => {
		ghost.getWorldDatabasePath()
			.then(path => {
				return world.open(path)
					.then(() => world.getItemCategory(6))
					.then(category => {
						const { shortTitle } = category;

						expect(shortTitle).to.equal('Hand Cannon');
						world.close();
						done();
					})
					.catch(err => {
						world.close();
						done(err);
					});
			});
	});
});
