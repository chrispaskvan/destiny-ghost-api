/**
 * Token Model Tests
 */
'use strict';
var expect = require('chai').expect,
    Tokens = require('../models/Tokens');

var tokenModel = new Tokens();

describe('Get a new 10-digit token', function () {
    it('Should return a random 10-digit number', function (done) {
        var token = tokenModel.getToken(10);
        expect(token.length).to.equal(10);
        done();
    });
});
describe('Get a new default 6-digit token', function () {
    it('Should return a random 6-digit number', function (done) {
        var token = tokenModel.getToken();
        expect(token.length).to.equal(6);
        done();
    });
});
