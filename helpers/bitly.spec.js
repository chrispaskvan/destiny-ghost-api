/**
 * Bitly Tests
 */
const bitly = require('./bitly');

describe('Bitly', () => {
    describe('getShortUrl', () => {
        it('should return a short URL', (done) => {
            bitly.getShortUrl('http://db.planetdestiny.com/items/view/3164616404')
                .then(function (url) {
                    expect(url).not.toBeUndefined;
                    done();
                })
                .catch(err => {
                    done(err);
                });
        });

        it('should not return a short URL', (done) => {
            bitly.getShortUrl()
                .then(() => {
                    done(new Error('expected method to reject'));
                })
                .catch(err => {
                    expect(err).not.toBeUndefined;
                    done();
                });
        });
    });
});
