/**
 * Created by chris on 3/5/16.
 */
'use strict';
var expect = require('chai').expect,
    Postmaster = require('../models/Postmaster'),
    users = require('../mocks/users.json');

var postmasterModel = new Postmaster();

describe('Get a new default 6-digit token', function () {
    it('Should return a random 6-digit number', function (done) {
        postmasterModel.register(users[0], '', 'http://www.google.com')
            .then(function (messageId) {
                expect(messageId).to.equal('mobile');
                done();
            })
            .fail(function (err) {
                done(err);
            });
    });
});
