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
    notifications: [
        {
            enabled: true,
            messages: [],
            type: 'Xur'
        }
    ],
    phoneNumber: cleanPhoneNumber(chance.phone({
        country: 'us',
        mobile: true
    }))
};
var userService;

beforeEach(function () {
    var cacheService = {
        getUser: function() {}
    };

    sinon.stub(cacheService, 'getUser').resolves();
    userService = new UserService(cacheService, documentService);
});

describe('UserService', function () {
    var mock;
    beforeEach(function () {
        mock = sinon.mock(documentService);
    });

    describe('addUserMessage', function () {
        var stub;
        beforeEach(function () {
            stub = sinon.stub(userService, 'getUserByDisplayName');
        });

        describe('when notification type is Xur', function () {
            it('should add message to list of Xur notifications', function () {
                var displayName = 'user1';
                var membershipType = 2;
                var message = {
                    sid: '1'
                };
                var notificationType = 'Xur';
                var user1 = JSON.parse(JSON.stringify(user));

                user1.notifications[0].messages.push(message);

                stub.resolves(user);
                mock.expects('upsertDocument').once().withArgs(sinon.match.any, user1).resolves();

                return userService.addUserMessage(displayName, membershipType, message, notificationType)
                    .then(function () {
                        mock.verify();
                    });
            });
        });
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
                return userService.createUser(_.omit(user, 'phoneNumber'))
                    .fail(function (err) {
                        expect(err).to.be.defined;
                    });
            });
        });
        describe('when user is valid', function () {
            // ToDo
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
        var cleanPhoneNumber = userService.cleanPhoneNumber(phoneNumber);

        expect(validator.isMobilePhone(cleanPhoneNumber, 'en-US')).to.equal(true);
        done();
    });
});
describe('Get the carrier type of a phone number', function () {
    it('Should return a type of mobile', function (done) {
        var phoneNumber = chance.phone({ country: 'us', mobile: true });
        var cleanPhoneNumber = userService.cleanPhoneNumber(phoneNumber);

        userService.getPhoneNumberType(cleanPhoneNumber)
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

        userService.getSubscribedUsers()
            .then(function (subscribedUsersBefore) {
                return userService.createUser(user)
                    .then(function () {
                        return userService.getRegisteredUsers()
                            .then(function (registeredUsersAfter) {
                                expect(registeredUsersAfter.length ===
                                    (subscribedUsersBefore.length + 1)).to.equal(true);
                                return userService.getSubscribedUsers()
                                    .then(function (subscribedUsersAfter) {
                                        expect(subscribedUsersAfter.length ===
                                            subscribedUsersBefore.length).to.equal(true);
                                        userService.deleteUser(user.phoneNumber);
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
