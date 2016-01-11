/**
 * Destiny Controller Tests
 */
'use strict';
var _ = require('underscore'),
    Chance = require('chance'),
    chai = require('chai'),
    chaiAsPromised = require('chai-as-promised'),
    foundryOrders = require('../mocks/foundryOrders.json'),
    ironBannerEventRewards = require('../mocks/ironBannerEventRewards.json'),
    Q = require('q'),
    rewire = require('rewire'),
    sinon = require('sinon'),
    xur = require('../mocks/xur.json');

chai.use(chaiAsPromised);
chai.should();
var getRandomId = function () {
    return _.random(1000000000000000000, 9999999999999999999);
};

var destinyController;
before(function (done) {
    var chance = new Chance();
    var destinyMock = function (apiKey) {
        var getCharacters = function (membershipId, callback) {
            var deferred = Q.defer();
            deferred.resolve([{ characterBase: { characterId: getRandomId() }},
                { characterBase: { characterId: getRandomId() }},
                { characterBase: { characterId: getRandomId() }}
            ]);
            return deferred.promise.nodeify(callback);
        };
        var getCurrentUser = function (cookieArray, callback) {
            var deferred = Q.defer();
            deferred.resolve({
                displayName: chance.first(),
                email: chance.email(),
                membershipId: getRandomId()
            });
            return deferred.promise.nodeify(callback);
        };
        var getIronBannerEventRewards = function (characterId, cookies, callback) {
            var deferred = Q.defer();
            deferred.resolve(ironBannerEventRewards);
            return deferred.promise.nodeify(callback);
        };
        var getFoundryOrders = function (characterId, cookies, callback) {
            var deferred = Q.defer();
            deferred.resolve(foundryOrders);
            return deferred.promise.nodeify(callback);
        };
        var getXur = function (callback) {
            var deferred = Q.defer();
            deferred.resolve(xur);
            return deferred.promise.nodeify(callback);
        };
        return {
            getCharacters: getCharacters,
            getCurrentUser: getCurrentUser,
            getIronBannerEventRewards: getIronBannerEventRewards,
            getFoundryOrders: getFoundryOrders,
            getXur: getXur
        };
    };
    var DestinyController = rewire('../controllers/destinyController');
    DestinyController.__set__('Destiny', destinyMock);
    destinyController = new DestinyController();
    done();
});

describe('Destiny Controller Tests', function () {
    describe('What rewards are available from Lord Saladin?', function () {
        it('Should return an array of weapons and class armor', function (done) {
            var req = {
                headers: {
                    cookie: 'bungled=; bungledid=; bungleatk='
                }
            };
            var deferred = Q.defer();
            var res = {
                json: function (ironBannerEventRewards) {
                    deferred.resolve(ironBannerEventRewards);
                }
            };
            destinyController.getIronBannerEventRewards(req, res);
            deferred.promise.should.become({
                armor: [{
                    hunter: [],
                    titan: [
                        'Iron Companion Greaves',
                        'Iron Companion Helm',
                        'Iron Camelot Helm'
                    ],
                    warlock: []
                }],
                weapons: [
                    'Haakon\'s Hatchet',
                    'Deidris\'s Retort'
                ]}).notify(done);
        });
    });
    describe('What foundry orders is Banshee-44 accepting?', function () {
        it('Should return an list of weapon names', function (done) {
            var req = {
                headers: {
                    cookie: 'bungled=; bungledid=; bungleatk='
                }
            };
            var deferred = Q.defer();
            var res = {
                json: function (foundryOrders) {
                    deferred.resolve(foundryOrders);
                }
            };
            destinyController.getFoundryOrders(req, res);
            deferred.promise.should.become([
                'SUROS PDX-41',
                'SUROS JLB-42',
                'SUROS JLB-47',
                'Häkke Strongbow-D',
                'Häkke Tamar-D']).notify(done);
        });
    });
    describe('What exotics are up for sale by the Agent of 9?', function () {
        it('Should return a list of exotic armor and/or weapons', function (done) {
            var req = {
                headers: {
                    cookie: 'bungled=; bungledid=; bungleatk='
                }
            };
            var deferred = Q.defer();
            var res = {
                json: function (xur) {
                    deferred.resolve(xur);
                }
            };
            destinyController.getXur(req, res);
            deferred.promise.should.become([
                'No Backup Plans',
                'Knucklehead Radar',
                'Apotheosis Veil',
                'Dragon\'s Breath',
                'Legacy Engram']).notify(done);
        });
    });
});
