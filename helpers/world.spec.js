/**
 * World Model Tests
 */
const World = require('./world'),
	expect = require('chai').expect;

const world = new World({
	directory: process.env.DESTINY_DATABASE_DIR
});

describe('It\'s Bungie\'s 1st world. You\'re just querying it.', () => {
	it('should return the Hunter character class', (done) => {
		world.getClassByHash(671679327)
			.then(characterClass => {
				const { className } = characterClass;

				expect(className).to.equal('Hunter');
				done();
			})
			.catch(err => {
				done(err);
			});
	});

	it('should return the Fusion Rifle category definition', (done) => {
		world.categories = [
			{
				id: 9,
				shortTitle: 'Fusion Rifle'
			}
		];

		world.getItemCategory(9)
			.then(itemCategory => {
				expect(itemCategory.shortTitle).to.equal('Fusion Rifle');
				done();
			})
			.catch(err => {
				done(err);
			});
	});

	it('should return Fatebringer', (done) => {
		world.items = [
			{
				itemName: 'Fatebringer',
				qualityLevel: 0
			}
		];

		world.getItemByName('Fatebringer')
			.then(items => {
				expect(items[0].itemName).to.equal('Fatebringer');
				done();
			})
			.catch(err => {
				done(err);
			});
	});

	it('should return year 2 Hawkmoon', (done) => {
		world.items = [
			{
				instanced: false,
				itemName: 'Oldest Hawkmoon',
				qualityLevel: 1
			},
			{
				instanced: false,
				itemName: 'Older Hawkmoon',
				qualityLevel: 0
			},
			{
				instanced: true,
				itemName: 'Hawkmoon',
				qualityLevel: 0
			}
		];

		world.getItemByName('Hawkmoon')
			.then(items => {
				const { itemName: hawkmoon } = items.find(item => item.instanced);

				expect(hawkmoon).to.equal('Hawkmoon');
				expect(items.length).to.equal(3);
				done();
			})
			.catch(err => {
				done(err);
			});
	});

	it('should return the icon of the Agent of Nine', (done) => {
		world.vendors = [
			{
				summary: {
					vendorIcon: 'someIcon'
				},
				vendorHash: '2796397637'
			}
		];

		world.getVendorIcon('2796397637')
			.then(url => {
				expect(url).to.exist;
				done();
			})
			.catch(err => {
				done(err);
			});
	});
});
