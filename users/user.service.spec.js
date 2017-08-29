/**
 * User Service Tests
 */
'use strict';
var _ = require('underscore'),
    chance = require('chance')(),
    expect = require('chai').expect,
    sinon = require('sinon'),
    UserService = require('./user.service');

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
/**
 * Anonymous User
 * @type {{displayName: string, membershipId: string, membershipType: number}}
 */
var anonymousUser = {
    displayName: 'displayName1',
    membershipId: '11',
    membershipType: 2
};
/**
 * User
 * @type {{displayName: string, emailAddress: *, firstName: *, lastName: *, membershipId: string, membershipType: number, notifications: *[], phoneNumber: string}}
 */
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

var cacheService = {
    getUser: function() {
        return Promise.resolve();
    }
};

var userService;

beforeEach(function () {
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
                    .catch(function (err) {
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
                    .catch(function (err) {
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
        describe('when user is cached', function () {
            let mockCache;

            beforeEach(function () {
                mockCache = sinon.mock(cacheService);
            });

            it('should return cached user', function () {
                mockCache.expects('getUser').once().resolves(user);
                mock.expects('getDocuments').never();

                return userService.getUserByDisplayName(user.displayName, user.membershipType)
                    .then(function (user1) {
                        expect(user1.displayName).to.equal(user.displayName);
                        mock.verify();
                    });
            });

            afterEach(function () {
                mockCache.restore();
            });
        });
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
            it('should fail when more than one existing user is found', function () {
                mock.expects('getDocuments').once().resolves([user, user]);

                return userService.getUserByDisplayName(user.displayName)
                    .catch(function (err) {
                        expect(err).to.be.defined;
                        mock.verify();
                    });
            });
            it('should return undefined is user is not found', function () {
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
                    .catch(function (err) {
                        expect(err).to.be.defined;
                        mock.verify();
                    });
            });
            it('should fail when no documents are returned', function () {
                mock.expects('getDocuments').once().resolves(undefined);

                return userService.getUserByDisplayName(user.displayName)
                    .catch(function (err) {
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
            it('should fail when more than one existing user is found', function () {
                mock.expects('getDocuments').once().resolves([user, user]);

                return userService.getUserByEmailAddress(user.emailAddress, user.membershipType)
                    .catch(function (err) {
                        expect(err).to.be.defined;
                        mock.verify();
                    });
            });
            it('should fail when no users are found', function () {
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
                    .catch(function (err) {
                        expect(err).to.be.defined;
                        mock.verify();
                    });
            });
            it('should fail when membership type is missing', function () {
                mock.expects('getDocuments').never();

                return userService.getUserByEmailAddress(user.emailAddress)
                    .catch(function (err) {
                        expect(err).to.be.defined;
                        mock.verify();
                    });
            });
            it('should fail when no documents are found', function () {
                mock.expects('getDocuments').once().resolves(undefined);

                return userService.getUserByEmailAddress(user.emailAddress, user.membershipType)
                    .catch(function (err) {
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
