/**
 * Destiny Controller Tests
 */
'use strict';
var AuthenticationController = require('../controllers/AuthenticationController'),
    chai = require('chai'),
    chaiAsPromised = require('chai-as-promised'),
    madridMountain = require('../settings/MadridMountain.json'),
    Q = require('q'),
    sinon = require('sinon');

chai.use(chaiAsPromised);
chai.should();

var authenticationController;
before(function (done) {
    authenticationController = new AuthenticationController();
    done();
});

describe('Authentication Controller Tests', function () {
    describe('Authenticate', function () {
        it('Should authenticate successfully', function (done) {
            this.timeout(0);
            var req = {
                body: {
                    userName: madridMountain.userName,
                    password: madridMountain.password,
                    membershipType: madridMountain.membershipType
                }
            };
            var deferred = Q.defer();
            var res = {
                header: function (name, value) {
                    if (name === 'Set-Cookie') {
                        deferred.resolve(value);
                    }
                }
            };
            authenticationController.signIn(req, res);
            deferred.promise.should.eventually.have.length(3).notify(done);
        });
    });
});
