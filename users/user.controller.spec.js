'use strict';
var assert = require('assert');
var expect = require('chai').expect;
var should = require('chai').should();
var chai = require('chai');
var chaiAsPromised = require('chai-as-promised');
var sinon = require('sinon');
var Q = require('q');

var UserController = require('./user.controller');

chai.use(chaiAsPromised);
chai.should();

var destiny = {
    getCurrentUser: function (accessToken) {
        return {};
    }
};
var users = {
    getUserByDisplayName: function (displayName, membershipType) {
        return {
            displayName: displayName,
            membershipType: membershipType
        };
    }
};

var deferred1 = Q.defer();
var stub1 = sinon.stub(destiny, 'getCurrentUser');
stub1.returns(deferred1.promise);

var deferred = Q.defer();
var stub = sinon.stub(users, 'getUserByDisplayName');
stub.returns(deferred.promise);


var userController;

beforeEach(function settingUpRoles() {
    userController = new UserController(destiny, users);
});


describe('UserController', function () {
    describe('getCurrentUser', function () {
        it('Should not return a user', function (done) {
            var req = {
                session: {}
            };
            var res = {
                status: sinon.spy(function () {
                    done();
                })
            };

            userController.getCurrentUser(req, res);
            expect(res.send).to.have.been.calledWith(401);
        });
        it('Should return the current user', function (done) {
            var req = {
                session: {
                    displayName: 'displayName1'
                }
            };
            var res = {
                status: sinon.spy(function () {
                    done();
                })
            };

            deferred1.resolve(['yyy']);
            deferred.resolve(['xxx']);

            userController.getCurrentUser(req, res);
            expect(res.send).to.have.been.calledWith(401);
        });
    });
});
