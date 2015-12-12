/**
 * Created by chris on 11/29/15.
 */
/**
 * Created by chris on 11/20/15.
 */
/**
 * Created by chris on 9/29/15.
 */
'use strict';
var _ = require('underscore'),
    expect = require('chai').expect,
    fs = require('fs'),
    User = require('../models/User');

describe('User Model Tests', function () {
    describe('Sign In', function () {
        it('should return valid bungie.net cookies', function () {
            var shadowUser = JSON.parse(fs.readFileSync('settings/MadridMountain.json'));
            var userModel = new User(process.env.DATABASE);
            this.timeout(0);
            return userModel.signIn(shadowUser.userName, shadowUser.password)
                .then(function (tokens) {
                    expect(tokens.bungled).to.equal('1247238604876779483');
                });
        });
    });
});
