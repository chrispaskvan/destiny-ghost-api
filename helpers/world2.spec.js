/**
 * World Model Tests
 */
const World = require('./world2');
const { xurHash } = require('../destiny2/destiny2.constants');

const world = new World({
    directory: process.env.DESTINY2_DATABASE_DIR,
});

describe('It\'s Bungie\'s 2nd world. You\'re just querying it.', () => {
    it('should return the lore for Ghost Primus', done => {
        world.getLore(2505533224)
            .then(lore => {
                const { displayProperties: { name } } = lore;

                expect(name).toEqual('Ghost Primus');
                done();
            })
            .catch(err => {
                done(err);
            });
    });

    it('should return the item category Hand Cannon', done => {
        world.getItemCategory(6)
            .then(category => {
                const { displayProperties: { name } } = category;

                expect(name).toEqual('Hand Cannon');
                done();
            })
            .catch(err => {
                done(err);
            });
    });

    it('should return the Hunter character class', done => {
        world.getClassByHash(671679327)
            .then(characterClass => {
                const { displayProperties: { name } } = characterClass;

                expect(name).toEqual('Hunter');
                done();
            })
            .catch(err => {
                done(err);
            });
    });

    it('should return Night Watch', done => {
        const itemName = 'Night Watch';

        world.getItemByName(itemName)
            .then(items => {
                expect(items[0].displayProperties.name).toEqual(itemName);
                done();
            })
            .catch(err => {
                done(err);
            });
    });

    it('should return the icon of the Agent of Nine', done => {
        world.getVendorIcon(xurHash)
            .then(url => {
                expect(url).toBeDefined();
                done();
            })
            .catch(err => {
                done(err);
            });
    });
});
