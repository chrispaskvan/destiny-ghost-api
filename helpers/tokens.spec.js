/**
 * Token Tests
 */
'use strict';
var _ = require('underscore'),
    expect = require('chai').expect,
    tokens = require('./tokens');

describe('Tokens', function () {
    describe('getBlob', function () {
        it('should return a blob', function () {
            var blob = tokens.getBlob();

            expect(blob).to.not.be.undefined;
        });
    });
    describe('getCode', function () {
        describe('when a code is requested without specifying a length', function () {
            it('should return a code with the default length of 6', function () {
                var token = tokens.getToken();

                expect(token.length).to.equal(6);
            });
        });
        describe('when the number of characters in the code is specified', function () {
            it('should return a code of the specified length', function () {
                var size = 12;
                var token = tokens.getToken(size);

                expect(token.length).to.equal(size);
            });
        });
    });
});