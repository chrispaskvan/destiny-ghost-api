/**
 * Postmaster Model Tests
 */
'use strict';
var expect = require('chai').expect,
    Postmaster = require('../helpers/postmaster'),
    users = require('../mocks/users.json');

var postmasterModel = new Postmaster();

describe('Postmaster delivery test', function () {
    var image = 'https://www.bungie.net/common/destiny_content/icons/31a1c9d954b69c41733b2fda109aa27c.png';
    var url = '/register';

    beforeEach(function () {
        process.env.DOMAIN = 'http://localhost:1100';
    });
    it('Should return a message Id', function (done) {
        this.timeout(10000);
        var user = users[0];
        postmasterModel.register(user, image, url)
            .then(function (response) {
                expect(response.accepted[0]).to.equal(user.emailAddress);
                done();
            })
            .fail(function (err) {
                done(err);
            });
    });
    afterEach(function () {
        delete process.env.DOMAIN;
    });
});
