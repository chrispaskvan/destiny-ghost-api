/**
 * Bitly Tests
 */
const expect = require('chai').expect,
    bitly = require('./bitly');

describe('Bitly', function () {
    describe('getShortUrl', function () {
        it('should return a short URL', function (done) {
            bitly.getShortUrl('http://db.planetdestiny.com/items/view/3164616404')
                .then(function (url) {
                    expect(url).to.not.be.undefined;
                    done();
                })
                .catch(function (err) {
                    done(err);
                });
        });

        it('should not return a short URL', function (done) {
            bitly.getShortUrl()
                .then(function () {
                    done(new Error('expected method to reject'));
                })
                .catch(function (err) {
                    expect(err).to.not.be.undefined;
                    done();
                });
        });
    });
});