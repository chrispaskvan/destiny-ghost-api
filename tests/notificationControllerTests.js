/**
 * Notification Controller Tests
 */
'use strict';
var _ = require('underscore'),
    Chance = require('chance'),
    chai = require('chai'),
    chaiAsPromised = require('chai-as-promised'),
    foundryOrders = require('../mocks/foundryOrders.json'),
    ironBannerEventRewards = require('../mocks/ironBannerEventRewards.json'),
    notificationHeaders = require('../settings/notificationHeaders.json'),
    Q = require('q'),
    rewire = require('rewire'),
    users = require('../mocks/users.json'),
    xur = require('../mocks/xur.json');

chai.use(chaiAsPromised);
chai.should();
var getRandomId = function () {
    return _.random(1000000000000000000, 9999999999999999999);
};

var notificationController;
before(function (done) {
    var chance = new Chance();
    var destinyMock = function () {
        var getCharacters = function (membershipId, membershipType, callback) {
            var deferred = Q.defer();
            deferred.resolve(
                [
                    { characterBase: { characterId: getRandomId() }},
                    { characterBase: { characterId: getRandomId() }},
                    { characterBase: { characterId: getRandomId() }}
                ]
            );
            return deferred.promise.nodeify(callback);
        };
        var getCurrentUser = function (cookies, callback) {
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
    var usersMock = function () {
        var createUserMessage = function (callback) {
            var deferred = Q.defer();
            deferred.resolve(undefined);
            return deferred.promise.nodeify(callback);
        };
        var getLastNotificationDate = function (callback) {
            var deferred = Q.defer();
            deferred.resolve(undefined);
            return deferred.promise.nodeify(callback);
        };
        var getSubscribedUsers = function (callback) {
            var deferred = Q.defer();
            deferred.resolve(users);
            return deferred.promise.nodeify(callback);
        };
        return {
            createUserMessage: createUserMessage,
            getLastNotificationDate: getLastNotificationDate,
            getSubscribedUsers: getSubscribedUsers
        };
    };
    var NotificationController = rewire('../controllers/notificationController');
    NotificationController.__set__('Destiny', destinyMock);
    NotificationController.__set__('Users', usersMock);
    notificationController = new NotificationController();
    done();
});

describe('Notification Controller Tests', function () {
    describe('Send notifications for Xur', function () {
        it('Should return successfully', function (done) {
            this.timeout(7000);
            setTimeout(done, 6000);
            var req = {
                headers: {},
                params: {
                    subscription: '4'
                }
            };
            _.each(_.keys(notificationHeaders), function (headerName) {
                req.headers[headerName] = notificationHeaders[headerName];
            });
            var deferred = Q.defer();
            var res = {
                writeHead: function () {
                    return null;
                },
                end: function (responseText) {
                    deferred.resolve(responseText);
                }
            };
            notificationController.createNotifications(req, res);
            deferred.promise.should.become('Success\n').notify(done);
        });
    });
});
