/**
 * Token Tests
 */
const expect = require('chai').expect,
    tokens = require('./tokens');

describe('Tokens', () => {
    describe('getBlob', () => {
        it('should return a blob', () => {
            const blob = tokens.getBlob();

            expect(blob).to.not.be.undefined;
        });
    });
    describe('getCode', () => {
        describe('when a code is requested without specifying a length', () => {
            it('should return a code with the default length of 6', () => {
                const token = tokens.getCode();

                expect(token.length).to.equal(6);
            });
        });
        describe('when the number of characters in the code is specified', () => {
            it('should return a code of the specified length', () => {
                const size = 12;
                const token = tokens.getCode(size);

                expect(token.length).to.equal(size);
            });
        });
    });
});
