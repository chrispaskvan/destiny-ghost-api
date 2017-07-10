/**
 * World Model Tests
 */
'use strict';
var expect = require('chai').expect,
    path = require('path'),
    Ghost = require('../models/ghost'),
    World = require('../models/World');

describe('It\'s Bungie\'s world, you\'re just querying it.', function () {
    it('Should return the Fusion Rifle category definition', function (done) {
        var ghost = new Ghost();
        var world = new World();
        ghost.getLastManifest()
            .then(function (lastManifest) {
                world.open(path.join('./databases/', path.basename(lastManifest.mobileWorldContentPaths.en)));
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
    it('Should return Fatebringer', function (done) {
        var ghost = new Ghost();
        var world = new World();
        ghost.getLastManifest()
            .then(function (lastManifest) {
                world.open(path.join('./databases/', path.basename(lastManifest.mobileWorldContentPaths.en)));
                world.getItemByName('Fatebringer')
                    .then(function (items) {
                        world.close();
                        expect(items[0].itemName).to.equal('Fatebringer');
                        done();
                    })
                    .fail(function (err) {
                        done(err);
                    });
            });
    });
    it('Should return year 2 Hawkmoon', function (done) {
        var ghost = new Ghost();
        var world = new World();
        ghost.getLastManifest()
            .then(function (lastManifest) {
                world.open(path.join('./databases/', path.basename(lastManifest.mobileWorldContentPaths.en)));
                world.getItemByName('Hawkmoon')
                    .then(function (items) {
                        world.close();
                        console.log(items);
                        expect(items[0].itemName).to.equal('Hawkmoon');
                        expect(items[0].qualityLevel).to.equal(0);
                        expect(items.length).to.equal(1);
                        done();
                    })
                    .fail(function (err) {
                        done(err);
                    });
            });
    });
    it('Should return the icon of the Agent of Nine', function (done) {
        var ghost = new Ghost();
        var world = new World();
        ghost.getLastManifest()
            .then(function (lastManifest) {
                world.open(path.join('./databases/', path.basename(lastManifest.mobileWorldContentPaths.en)));
                world.getVendorIcon('2796397637')
                    .then(function (url) {
                        world.close();
                        expect(url).to.exist;
                        done();
                    })
                    .fail(function (err) {
                        done(err);
                    });
            });
    });
});
