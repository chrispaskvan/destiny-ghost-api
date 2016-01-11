/**
 * Created by chris on 11/29/15.
 */
var expect = require('chai').expect,
    Destiny = require('../models/destiny'),
    user = require('../settings/ShadowUser.json');

describe('Destiny Model Tests', function () {
    describe('Get the latest manifest definition', function () {
        it('Should details of the current Bungie Destiny manifest definition', function (done) {
            var destiny = new Destiny(user.apiKey);
            destiny.getManifest()
                .then(function (manifest) {
                    expect(manifest).to.include.keys('version');
                    done();
                });
        });
    });
});
