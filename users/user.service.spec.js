/**
 * User Service Tests
 */
'use strict';
var _ = require('underscore'),
    chance = require('chance')(),
    expect = require('chai').expect,
    sinon = require('sinon'),
    UserService = require('./user.service'),
    validator = require('validator');

var documentService = require('../helpers/documents');

/**
 * Get the phone number format into the Twilio standard.
 * @param phoneNumber
 * @returns {string}
 * @private
 */
function cleanPhoneNumber(phoneNumber) {
    var cleaned = phoneNumber.replace(/\D/g, '');
    return '+1' + cleaned;
}

var anonymousUser = {
    displayName: 'displayName1',
    membershipId: '11',
    membershipType: 2
};
var user = {
    displayName: 'displayName1',
    emailAddress: chance.email(),
    firstName: chance.first(),
    lastName: chance.last(),
    membershipId: '11',
    membershipType: 2,
    notifications: [],
    phoneNumber: cleanPhoneNumber(chance.phone({
        country: 'us',
        mobile: true
    }))
};
var userService;

beforeEach(function () {
    userService = new UserService(documentService);
});

describe.only('UserService', function () {
    var mock;
    beforeEach(function () {
        mock = sinon.mock(documentService);
    });

    describe('createAnonymousUser', function () {
        var stub;
        beforeEach(function () {
            stub = sinon.stub(userService, 'getUserByDisplayName');
        });

        describe('when anonymous user is invalid', function () {
            it('should reject the anonymous user', function () {
                return userService.createAnonymousUser(_.omit(anonymousUser, 'membershipId'))
                    .fail(function (err) {
                        expect(err).to.be.defined;
                    });
            });
        });
        describe('when anonymous user is valid', function () {
            describe('when the anonymous user exists', function () {
                it('should reject the anonymous user', function () {
                    stub.resolves(anonymousUser);
                    mock.expects('createDocument').never();
                    mock.expects('upsertDocument').once();

                    return userService.createAnonymousUser(anonymousUser)
                        .then(function () {
                            mock.verify();
                        });
                });
            });
            describe('when the anonymous user does not exists', function () {
                it('should reject the anonymous user', function () {
                    stub.resolves();
                    mock.expects('createDocument').once();
                    mock.expects('upsertDocument').never();

                    return userService.createAnonymousUser(anonymousUser)
                        .then(function () {
                            mock.verify();
                        });
                });
            });
        });

        afterEach(function () {
            stub.restore();
        });
    });
    describe('createUser', function () {
        var stub;
        beforeEach(function () {
            stub = sinon.stub(userService, 'getUserByDisplayName');
        });

        describe('when user is invalid', function () {
            it('should reject the user', function () {
                return userService.createUser(_.omit(user, 'notifications'))
                    .fail(function (err) {
                        expect(err).to.be.defined;
                    });
            });
        });
        describe('when user is valid', function () {
        });

        afterEach(function () {
            stub.restore();
        });
    });
    describe('getUserByDisplayName', function () {
        describe('when display name is defined', function () {
            describe('when membership type is defined', function () {
                it('should return an existing user', function () {
                    mock.expects('getDocuments').once().withArgs(sinon.match.any, sinon.match.any, undefined).resolves([user]);

                    return userService.getUserByDisplayName(user.displayName, user.membershipType)
                        .then(function (user1) {
                            expect(user1.displayName).to.equal(user.displayName);
                            mock.verify();
                        });
                });
            });
            describe('when membership type is not defined', function () {
                it('should return an existing user', function () {
                    mock.expects('getDocuments').once().withArgs(sinon.match.any, sinon.match.any, {
                        enableCrossPartitionQuery: true
                    }).resolves([user]);

                    return userService.getUserByDisplayName(user.displayName)
                        .then(function (user1) {
                            expect(user1.displayName).to.equal(user.displayName);
                            mock.verify();
                        });
                });
            });
            it('should not return an existing user', function () {
                mock.expects('getDocuments').once().resolves([user, user]);

                return userService.getUserByDisplayName(user.displayName)
                    .fail(function (err) {
                        expect(err).to.be.defined;
                        mock.verify();
                    });
            });
            it('should fail when more than one existing user is returned', function () {
                mock.expects('getDocuments').once().resolves([]);

                return userService.getUserByDisplayName(user.displayName)
                    .then(function (user1) {
                        expect(user1).to.not.be.defined;
                        mock.verify();
                    });
            });
            it('should fail when display name is empty', function () {
                mock.expects('getDocuments').never();

                return userService.getUserByDisplayName()
                    .fail(function (err) {
                        expect(err).to.be.defined;
                        mock.verify();
                    });
            });
            it('should fail when no documents are returned', function () {
                mock.expects('getDocuments').once().resolves(undefined);

                return userService.getUserByDisplayName(user.displayName)
                    .fail(function (err) {
                        expect(err).to.be.defined;
                        mock.verify();
                    });
            });
        });
    });
    describe('getUserByEmailAddress', function () {
        describe('when email address and membership type are defined', function () {
            it('should return an existing user', function () {
                mock.expects('getDocuments').once().resolves([user]);

                return userService.getUserByEmailAddress(user.emailAddress, user.membershipType)
                    .then(function (user1) {
                        expect(user1).to.equal(user);
                        mock.verify();
                    });
            });
            it('should fail when more than one existing user is returned', function () {
                mock.expects('getDocuments').once().resolves([user, user]);

                return userService.getUserByEmailAddress(user.emailAddress, user.membershipType)
                    .fail(function (err) {
                        expect(err).to.be.defined;
                        mock.verify();
                    });
            });
            it('should fail when no users are returned', function () {
                mock.expects('getDocuments').once().resolves([]);

                return userService.getUserByEmailAddress(user.emailAddress, user.membershipType)
                    .then(function (user1) {
                        expect(user1).to.not.be.defined;
                        mock.verify();
                    });
            });
            it('should fail when email address is empty', function () {
                mock.expects('getDocuments').never();

                return userService.getUserByEmailAddress()
                    .fail(function (err) {
                        expect(err).to.be.defined;
                        mock.verify();
                    });
            });
            it('should fail when membership type is missing', function () {
                mock.expects('getDocuments').never();

                return userService.getUserByEmailAddress(user.emailAddress)
                    .fail(function (err) {
                        expect(err).to.be.defined;
                        mock.verify();
                    });
            });
            it('should fail when no documents are found', function () {
                mock.expects('getDocuments').once().resolves(undefined);

                return userService.getUserByEmailAddress(user.emailAddress, user.membershipType)
                    .fail(function (err) {
                        expect(err).to.be.defined;
                        mock.verify();
                    });
            });
        });
    });

    afterEach(function () {
        mock.restore();
    });
});

describe('Format a phone number', function () { // jshint ignore:line
    it('Should return a properly formatted phone number', function (done) {
        var phoneNumber = chance.phone({ country: 'us', mobile: true });
        var cleanPhoneNumber = users.cleanPhoneNumber(phoneNumber);

        expect(validator.isMobilePhone(cleanPhoneNumber, 'en-US')).to.equal(true);
        done();
    });
});
describe('Get the carrier type of a phone number', function () {
    it('Should return a type of mobile', function (done) {
        var phoneNumber = chance.phone({ country: 'us', mobile: true });
        var cleanPhoneNumber = users.cleanPhoneNumber(phoneNumber);
        users.getPhoneNumberType(cleanPhoneNumber)
            .then(function (phoneNumberType) {
                expect(phoneNumberType.type).to.equal('mobile');
                done();
            })
            .fail(function (err) {
                done(err);
            });
    });
});
describe('Create a new user', function () {
    it('Should add a new valid user', function (done) {
        var user = {
            firstName: chance.first(),
            emailAddress: chance.email(),
            gamerTag: 'PocketInfinity',
            lastName: chance.last(),
            phoneNumber: users.cleanPhoneNumber(chance.phone({
                country: 'us',
                mobile: true
            })),
            isSubscribedToXur: true,
            membershipId: '11',
            membershipType: 2,
            notifications: []
        };
        users.getSubscribedUsers()
            .then(function (subscribedUsersBefore) {
                return users.createUser(user)
                    .then(function () {
                        return users.getRegisteredUsers()
                            .then(function (registeredUsersAfter) {
                                expect(registeredUsersAfter.length ===
                                    (subscribedUsersBefore.length + 1)).to.equal(true);
                                return users.getSubscribedUsers()
                                    .then(function (subscribedUsersAfter) {
                                        expect(subscribedUsersAfter.length ===
                                            subscribedUsersBefore.length).to.equal(true);
                                        users.deleteUser(user.phoneNumber);
                                        done();
                                    });
                            });
                    });
            })
            .fail(function (err) {
                done(err);
            });
    });
});
describe('Get a new 32-bit globally unique identifier', function () {
    it('Should return a random identification number', function (done) {
        users.getBlob(32)
            .then(function (id) {
                expect(id.length).to.equal(64);
                done();
            })
            .fail(function (err) {
                done(err);
            });
    });
});
describe('Get a new 16-bit globally unique identifier', function () {
    it('Should return a random identification number', function (done) {
        users.getBlob()
            .then(function (id) {
                expect(id.length).to.equal(32);
                done();
            })
            .fail(function (err) {
                done(err);
            });
    });
});
