/**
 * World Model Tests
 */
const Ghost = require('../ghost/ghost'),
	World = require('./world'),
	expect = require('chai').expect,
	mockManifest = require('../mocks/manifestResponse').Response;

const mockDestinyService = {
	getManifest: () => Promise.resolve(mockManifest)
};

const world = new World();

describe('It\'s Bungie\'s 1st world. You\'re just querying it.', function () {
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
				world.getClassByHash(671679327)
					.then(characterClass => {
						const { className } = characterClass;

						world.close();

						expect(className).to.equal('Hunter');
						done();
					})
					.catch(err => {
						world.close();
						done(err);
					});
			});
	});

	it('should return the Fusion Rifle category definition', function (done) {
		ghost.getWorldDatabasePath()
			.then(path => {
				world.open(path);
				world.getItemCategory(9)
					.then(itemCategory => {
						world.close();

						expect(itemCategory.shortTitle).to.equal('Fusion Rifle');
						done();
					})
					.catch(err => {
						world.close();
						done(err);
					});
			});
	});

	it('should return Fatebringer', function (done) {
		ghost.getWorldDatabasePath()
			.then(path => {
				world.open(path);
				world.getItemByName('Fatebringer')
					.then(items => {
						world.close();

						expect(items[0].itemName).to.equal('Fatebringer');
						done();
					})
					.catch(err => {
						world.close();
						done(err);
					});
			});
	});

	it('should return year 2 Hawkmoon', function (done) {
		ghost.getWorldDatabasePath()
			.then(path => {
				world.open(path);
				world.getItemByName('Hawkmoon')
					.then(items => {
						const { itemName: hawkmoon } = items.find(item => item.instanced);

						world.close();

						expect(hawkmoon).to.equal('Hawkmoon');
						expect(items.length).to.equal(3);
						done();
					})
					.catch(err => {
						world.close();
						done(err);
					});
			});
	});

	it('should return the icon of the Agent of Nine', function (done) {
		ghost.getWorldDatabasePath()
			.then(path => {
				world.open(path);
				world.getVendorIcon('2796397637')
					.then(url => {
						world.close();

						expect(url).to.exist;
						done();
					})
					.catch(err => {
						world.close();
						done(err);
					});
			});
	});
});
