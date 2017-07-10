/**
 * User Controller Tests
 */
'use strict';
var _ = require('underscore'),
    Chance = require('chance'),
    chai = require('chai'),
    chaiAsPromised = require('chai-as-promised'),
    jSend = require('../models/jsend'),
    Q = require('q'),
    rewire = require('rewire'),
    users = require('../mocks/users.json');

chai.use(chaiAsPromised);
chai.should();
var chance = new Chance();
chance.mixin({
    user: function () {
        return {
            emailAddress: chance.email(),
            firstName: chance.first(),
            gamerTag: chance.word(),
            lastName: chance.last(),
            membershipType: chance.integer({min: 1, max: 2}),
            phoneNumber: chance.phone({
                country: 'us',
                mobile: true
            }),
            timeStamp: new Date(),
            tokens: {
                emailAddress: '20a3ec4398eed2bd7fc30b0b30cc4b6f',
                phoneNumber: chance.n(chance.integer, 6, {min: 0, max: 9})
            }
        };
    }
});
var newUser = chance.user();
var getRandomId = function () {
    return _.random(1000000000000000000, 9999999999999999999);
};

var userController;
before(function (done) {
    var destinyMock = function () {
        var getMembershipIdFromDisplayName = function (gamerTag, membershipType, callback) {
            var deferred = Q.defer();
            deferred.resolve(getRandomId());
            return deferred.promise.nodeify(callback);
        };
        return {
            getMembershipIdFromDisplayName: getMembershipIdFromDisplayName
        };
    };
    var usersMock = function () {
        var createUser = function (user, callback) {
            var deferred = Q.defer();
            deferred.resolve();
            return deferred.promise.nodeify(callback);
        };
        var createUserMessage = function (callback) {
            var deferred = Q.defer();
            deferred.resolve();
            return deferred.promise.nodeify(callback);
        };
        var createUserToken = function (user, callback) {
            var deferred = Q.defer();
            deferred.resolve();
            return deferred.promise.nodeify(callback);
        };
        var getBlob = function (numberOfBytes, callback) {
            var deferred = Q.defer();
            deferred.resolve(newUser.tokens.emailAddress);
            return deferred.promise.nodeify(callback);
        };
        var getLastNotificationDate = function (callback) {
            var deferred = Q.defer();
            deferred.resolve();
            return deferred.promise.nodeify(callback);
        };
        var getSubscribedUsers = function (callback) {
            var deferred = Q.defer();
            deferred.resolve(users);
            return deferred.promise.nodeify(callback);
        };
        var getUserByPhoneNumber = function (phoneNumber, callback)  {
            var deferred = Q.defer();
            deferred.resolve();
            return deferred.promise.nodeify(callback);
        };
        var getUserTokenByPhoneNumber = function (phoneNumber, callback) {
            var deferred = Q.defer();
            deferred.resolve(newUser);
            return deferred.promise.nodeify(callback);
        };
        return {
            createUser: createUser,
            createUserMessage: createUserMessage,
            createUserToken: createUserToken,
            getBlob: getBlob,
            getLastNotificationDate: getLastNotificationDate,
            getSubscribedUsers: getSubscribedUsers,
            getUserByPhoneNumber: getUserByPhoneNumber,
            getUserTokenByPhoneNumber: getUserTokenByPhoneNumber
        };
    };
    var UserController = rewire('../controllers/userController');
    UserController.__set__('Destiny', destinyMock);
    UserController.__set__('Users', usersMock);
    userController = new UserController();
    done();
});

describe('New user registration and confirmation requests', function () {
    it('Should return successfully', function (done) {
        var req = {
            body: newUser
        };
        var deferred = Q.defer();
        var res = {
            json: function (response) {
                deferred.resolve(response);
            }
        };
        userController.register(req, res);
        deferred.promise.should.become(new jSend.success());
        userController.confirm(req, res);
        deferred.promise.should.become(new jSend.success()).notify(done);
    });
});
