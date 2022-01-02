/**
 * World Model Tests
 */
const fs = require('fs');
const World = require('./world');
const itif = require('./itif');

const directory = process.env.DESTINY_DATABASE_DIR;

describe('It\'s Bungie\'s 1st world. You\'re just querying it.', () => {
    itif(
        'should return 2 random Grimoire Cards',
        () => fs.existsSync(directory), // eslint-disable-line security/detect-non-literal-fs-filename, max-len
        async () => {
            const count = 2;
            const world = new World({
                directory,
            });

            const cards = await world.getGrimoireCards(count);
            const [{ cardId }] = cards;

            expect(cards.length).toEqual(count); // eslint-disable-line jest/no-standalone-expect, max-len
            expect(cardId).toEqual(expect.any(Number)); // eslint-disable-line jest/no-standalone-expect, max-len
        },
    );
});
