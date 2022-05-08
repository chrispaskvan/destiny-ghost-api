/**
 * Bitly Tests
 */
const bitly = require('./bitly');

// eslint-disable-next-line jest/no-disabled-tests
describe.skip('Bitly', () => {
    describe('getShortUrl', () => {
        it('should return a short URL', async () => bitly
            .getShortUrl('http://db.planetdestiny.com/items/view/3164616404')
            .then(url => {
                expect(url).toBeDefined();
            }));

        it('should not return a short URL', async () => expect(bitly.getShortUrl())
            .rejects.toThrow('URL is not a string'));
    });
});
