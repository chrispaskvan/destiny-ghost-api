/**
 * User Service Tests
 */
const _ = require('underscore'),
    UserService = require('./user.service'),
    chance = require('chance')(),
    documentService = require('../helpers/documents'),
    expect = require('chai').expect,
    sinon = require('sinon');

/**
 * Get the phone number format into the Twilio standard.
 * @param phoneNumber
 * @returns {string}
 * @private
 */
function cleanPhoneNumber(phoneNumber) {
    const cleaned = phoneNumber.replace(/\D/g, '');

    return '+1' + cleaned;
}
/**
 * Mock Anonymous User
 */
const anonymousUser = {
    displayName: 'displayName1',
	id: '1',
    membershipId: '11',
    membershipType: 2
};

/**
 * Mock User
 */
const user = {
    displayName: 'displayName1',
    emailAddress: chance.email(),
    firstName: chance.first(),
    id: '2',
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

/**
 * Mock Cache Service
 */
const cacheService = {
    getUser: function() {
        return Promise.resolve();
    }
};

let userService;

beforeEach(function () {
    userService = new UserService({ cacheService, documentService });
});

describe('UserService', function () {
    let mock;

    beforeEach(function () {
        mock = sinon.mock(documentService);
    });

    describe('addUserMessage', function () {
        let stub;

        beforeEach(function () {
            stub = sinon.stub(userService, 'getUserByDisplayName');
        });

        describe('when notification type is Xur', function () {
            it('should add message to list of Xur notifications', function () {
                const displayName = 'user1';
                const membershipType = 2;
                const message = {
                    sid: '1'
                };
                const notificationType = 'Xur';
                const user1 = JSON.parse(JSON.stringify(user));

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
                        expect(err).to.not.be.undefined;
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
        let stub;

        beforeEach(function () {
            stub = sinon.stub(userService, 'getUserByDisplayName');
        });

        describe('when user is invalid', function () {
            it('should reject the user', function () {
                return userService.createUser(_.omit(user, 'phoneNumber'))
                    .catch(function (err) {
                        expect(err).to.not.be.undefined;
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

        describe('when display name and membership type are defined', function () {
            it('should return an existing user', function () {
                mock.expects('getDocuments').once().withArgs(sinon.match.any, sinon.match.any).resolves([user]);

                return userService.getUserByDisplayName(user.displayName, user.membershipType)
                    .then(function (user1) {
                        expect(user1.displayName).to.equal(user.displayName);
                        mock.verify();
                    });
            });

            it('should fail when more than one existing user is found', function () {
                mock.expects('getDocuments').once().resolves([user, user]);

                return userService.getUserByDisplayName(user.displayName, user.membershipType)
                    .catch(function (err) {
                        expect(err).to.not.be.undefined;
                        mock.verify();
                    });
            });

            it('should return undefined is user is not found', function () {
                mock.expects('getDocuments').once().resolves([]);

                return userService.getUserByDisplayName(user.displayName, user.membershipType)
                    .then(function (user1) {
                        expect(user1).to.be.undefined;
                        mock.verify();
                    });
            });

            it('should fail when display name is empty', function () {
                mock.expects('getDocuments').never();

                return userService.getUserByDisplayName()
                    .catch(function (err) {
                        expect(err).to.not.be.undefined;
                        mock.verify();
                    });
            });

            it('should fail when membership type is not a number', function () {
                mock.expects('getDocuments').never();

                return userService.getUserByDisplayName(user.displayName, '1')
                    .catch(function (err) {
                        expect(err).to.not.be.undefined;
                        mock.verify();
                    });
            });

            it('should fail when no documents are returned', function () {
                mock.expects('getDocuments').once().resolves(undefined);

                return userService.getUserByDisplayName(user.displayName, user.membershipType)
                    .catch(function (err) {
                        expect(err).to.not.be.undefined;
                        mock.verify();
                    });
            });
        });
    });
    describe('getUserByEmailAddress', function () {
        describe('when email address and membership type are defined', function () {
            it('should return an existing user', function () {
                mock.expects('getDocuments').once().resolves([user]);

                return userService.getUserByEmailAddress(user.emailAddress)
                    .then(function (user1) {
                        expect(user1).to.equal(user);
                        mock.verify();
                    });
            });

            it('should fail when more than one existing user is found', function () {
                mock.expects('getDocuments').once().resolves([user, user]);

                return userService.getUserByEmailAddress(user.emailAddress)
                    .catch(function (err) {
                        expect(err).to.not.be.undefined;
                        mock.verify();
                    });
            });

            it('should fail when no users are found', function () {
                mock.expects('getDocuments').once().resolves([]);

                return userService.getUserByEmailAddress(user.emailAddress)
                    .then(function (user1) {
                        expect(user1).to.be.undefined;
                        mock.verify();
                    });
            });

            it('should fail when email address is empty', function () {
                mock.expects('getDocuments').never();

                return userService.getUserByEmailAddress()
                    .catch(function (err) {
                        expect(err).to.not.be.undefined;
                        mock.verify();
                    });
            });

            it('should fail when no documents are found', function () {
                mock.expects('getDocuments').once().resolves(undefined);

                return userService.getUserByEmailAddress(user.emailAddress)
                    .catch(function (err) {
                        expect(err).to.not.be.undefined;
                        mock.verify();
                    });
            });
        });
    });
	describe('getUserById', function () {
		describe('when user id defined', function () {
			it('should return an existing user', function () {
				mock.expects('getDocuments').once().resolves([user]);

				return userService.getUserById(user.id)
					.then(function (user1) {
						expect(user1).to.equal(user);
						mock.verify();
					});
			});

			it('should fail when more than one existing user is found', function () {
				mock.expects('getDocuments').once().resolves([user, user]);

				return userService.getUserById(user.id)
					.catch(function (err) {
						expect(err).to.not.be.undefined;
						mock.verify();
					});
			});

			it('should fail when no users are found', function () {
				mock.expects('getDocuments').once().resolves([]);

				return userService.getUserById(user.id)
					.then(function (user1) {
						expect(user1).to.be.undefined;
						mock.verify();
					});
			});

			it('should fail when user id is empty', function () {
				mock.expects('getDocuments').never();

				return userService.getUserById()
					.catch(function (err) {
						expect(err).to.not.be.undefined;
						mock.verify();
					});
			});

			it('should fail when no documents are found', function () {
				mock.expects('getDocuments').once().resolves(undefined);

				return userService.getUserById(user.id)
					.catch(function (err) {
						expect(err).to.not.be.undefined;
						mock.verify();
					});
			});
		});
	});

    afterEach(function () {
        mock.restore();
    });
});
