/**
 * Created by chris on 11/29/15.
 */
var _ = require('underscore'),
    assert = require('assert'),
    path = require('path'),
    should = require('should'),
    sinon = require('sinon'),
    Ghost = require('../models/ghost'),
    World = require('../models/World');

describe('Destiny Model Tests', function () {
    describe('Get Fusion Rifle Category', function () {
        it('should return valid membershipId', function () {
            var ghost = new Ghost();
            var world = new World();
            ghost.getLastManifest()
                .then(function (lastManifest) {
                    world.open(path.join('./database/', path.basename(lastManifest.mobileWorldContentPaths.en)));
                    return world.getItemCategory(9)
                        .then(function (itemCategory) {
                            console.write(JSON.stringify(itemCategory));
                            world.close();
                            return itemCategory;
                        });
                });
        });
    });
});
