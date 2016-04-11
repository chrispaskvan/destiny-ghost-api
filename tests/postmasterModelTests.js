/**
 * Postmaster Model Tests
 */
'use strict';
var expect = require('chai').expect,
    Postmaster = require('../models/Postmaster'),
    users = require('../mocks/users.json');

var postmasterModel = new Postmaster();

describe('Postmaster delivery test', function () {
    it('Should return a message Id', function (done) {
        this.timeout(10000);
        var user = users[0];
        postmasterModel.register(user, '', '')
            .then(function (response) {
                expect(response.accepted[0]).to.equal(user.emailAddress);
                done();
            })
            .fail(function (err) {
                done(err);
            });
    });
});
