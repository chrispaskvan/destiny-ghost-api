/**
 * Created by chris on 3/5/16.
 */
'use strict';
var expect = require('chai').expect,
    Postmaster = require('../models/Postmaster'),
    users = require('../mocks/users.json');

var postmasterModel = new Postmaster();

describe('Postmaster delivery test', function () {
    it('Should return a message Id', function (done) {
        postmasterModel.register(users[0], '', '')
            .then(function (messageId) {
                expect(messageId).to.equal('mobile');
                done();
            })
            .fail(function (err) {
                done(err);
            });
    });
});
