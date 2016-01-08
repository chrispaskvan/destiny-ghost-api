/**
 * World Tests
 */
'use strict';
var _ = require('underscore'),
    expect = require('chai').expect,
    path = require('path'),
    Ghost = require('../models/ghost'),
    World = require('../models/World');

describe('Get the Fusion Rifle category', function () {
    it('Should return the Fusion Rifle category definition', function (done) {
        var ghost = new Ghost();
        var world = new World();
        ghost.getLastManifest()
            .then(function (lastManifest) {
                world.open(path.join('./database/', path.basename(lastManifest.mobileWorldContentPaths.en)));
                world.getItemCategory(9)
                    .then(function (itemCategory) {
                        world.close();
                        expect(itemCategory.shortTitle).to.equal('Fusion Rifle');
                        done();
                    })
                    .fail(function (err) {
                        done(err);
                    });
            });
    });
});
