/**
 * World Model Tests
 */
const World = require('./world2'),
	expect = require('chai').expect;

const world = new World({
	directory: process.env.DESTINY2_DATABASE_DIR
});

describe('It\'s Bungie\'s 2nd world. You\'re just querying it.', () => {
	it('should return the lore for Ghost Primus', (done) => {
		world.getLore(2505533224)
			.then(lore => {
				const { displayProperties: { name }} = lore;

				expect(name).to.equal('Ghost Primus');
				done();
			})
			.catch(err => {
				done(err);
			});
	});

	it('should return the item category Hand Cannon', (done) => {
		world.getItemCategory(6)
			.then(category => {
				const { displayProperties: { name } } = category;

				expect(name).to.equal('Hand Cannon');
				done();
			})
			.catch(err => {
				done(err);
			});
	});
});
