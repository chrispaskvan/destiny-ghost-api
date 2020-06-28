/**
 * World Model Tests
 */
const World = require('./world');

const world = new World({
    directory: process.env.DESTINY_DATABASE_DIR,
});

describe('It\'s Bungie\'s 1st world. You\'re just querying it.', () => {
    it('should return 2 random Grimoire Cards', () => new Promise(done => {
        const count = 2;

        world.getGrimoireCards(count)
            .then(cards => {
                const [{ cardId }] = cards;

                expect(cards.length).toEqual(count);
                expect(cardId).toEqual(expect.any(Number));
                done();
            })
            .catch(err => {
                done(err);
            });
    }));
});
