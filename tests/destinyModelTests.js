/**
 * Destiny Model Tests
 */
'use strict';
var expect = require('chai').expect,
    Destiny = require('../models/destiny');

describe('Destiny Model Tests', function () {
    describe('Get the latest manifest definition', function () {
        it('Should details of the current Bungie Destiny manifest definition', function (done) {
            var destiny = new Destiny();
            destiny.getManifest()
                .then(function (manifest) {
                    expect(manifest).to.include.keys('version');
                    done();
                });
        });
    });
});
