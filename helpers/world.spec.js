/**
 * World Model Tests
 */
'use strict';
const Ghost = require('./ghost'),
    expect = require('chai').expect,
    mockManifest = require('../mocks/manifestResponse').Response,
    path = require('path'),
    world = require('./world');

const mockDestinyService = {
    getManifest: () =>  Promise.resolve(mockManifest)
};

describe('It\'s Bungie\'s world, you\'re just querying it.', function () {
    let ghost;

    beforeEach(function () {
        ghost = new Ghost(mockDestinyService);
    });

    it('Should return the Hunter character class', function (done) {
        ghost.getWorldDatabasePath()
            .then(path => {
                world.open(path);
                world.getClassByHash(671679327)
                    .then(characterClass => {
                        const { className } = characterClass;

                        expect(className).to.equal('Hunter');
                        done();
                    })
                    .catch(err => done(err))
                    .catch(err => done(err))
                    .finally(() => world.close());
            });
    });
    it('Should return the Fusion Rifle category definition', function (done) {
        ghost.getWorldDatabasePath()
            .then(path => {
                world.open(path);
                world.getItemCategory(9)
                    .then(itemCategory => {
                        world.close();
                        expect(itemCategory.shortTitle).to.equal('Fusion Rifle');
                        done();
                    })
                    .catch(err => done(err))
                    .finally(() => world.close());
            });
    });
    it('Should return Fatebringer', function (done) {
        ghost.getWorldDatabasePath()
            .then(path => {
                world.open(path);
                world.getItemByName('Fatebringer')
                    .then(items => {
                        world.close();
                        expect(items[0].itemName).to.equal('Fatebringer');
                        done();
                    })
                    .catch(err => done(err))
                    .finally(() => world.close());
            });
    });
    it('Should return year 2 Hawkmoon', function (done) {
        ghost.getWorldDatabasePath()
            .then(path => {
                world.open(path);
                world.getItemByName('Hawkmoon')
                    .then(items => {
                        const { itemName: hawkmoon } = items.find(item => item.instanced);

                        world.close();
                        expect(hawkmoon).to.equal('Hawkmoon');
                        expect(items.length).to.equal(3);
                        done();
                    })
                    .catch(err => done(err))
                    .finally(() => world.close());
            });
    });
    it('Should return the icon of the Agent of Nine', function (done) {
        ghost.getWorldDatabasePath()
            .then(path => {
                world.open(path);
                world.getVendorIcon('2796397637')
                    .then(url => {
                        expect(url).to.exist;
                        done();
                    })
                    .catch(err => done(err))
                    .finally(() => world.close());
            });
    });
});
