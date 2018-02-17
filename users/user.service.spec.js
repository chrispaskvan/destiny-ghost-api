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
    membershipType: 2,
	profilePicturePath: '/thing1'
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
    getUser: () => Promise.resolve(),
	setUser: () => Promise.resolve()
};

let userService;

beforeEach(() => {
    userService = new UserService({ cacheService, documentService });
});

describe('UserService', () => {
    let mock;

    beforeEach(() => {
        mock = sinon.mock(documentService);
    });

    describe('addUserMessage', () => {
        let stub;

        beforeEach(() => {
            stub = sinon.stub(userService, 'getUserByDisplayName');
        });

        describe('when notification type is Xur', () => {
            it('should add message to the list of Xur notifications', () => {
                const displayName = 'user1';
                const membershipType = 2;
                const message = {
                    sid: '1'
                };
                const notificationType = 'Xur';
                const user1 = JSON.parse(JSON.stringify(user));

                Object.assign(user1.notifications[0], { messages: [message] });

                stub.resolves(user);
                mock.expects('upsertDocument').once().withArgs(sinon.match.any, user1).resolves();

                return userService.addUserMessage(displayName, membershipType, message, notificationType)
                    .then(() => mock.verify());
            });
        });

        describe('when user has no previous messages of the notification type', () => {
            it('should create a new list of this notification type', () => {
				const displayName = 'user1';
				const membershipType = 2;
				const message = {
					sid: '1'
				};
				const notificationType = 'Banshee-44';
				const user1 = JSON.parse(JSON.stringify(user));

				user1.notifications.push({
					enabled: false,
					type: notificationType,
					messages: [message]
				});

				stub.resolves(user);
				mock.expects('upsertDocument').once().withArgs(sinon.match.any, user1).resolves();

				return userService.addUserMessage(displayName, membershipType, message, notificationType)
					.then(() => mock.verify());
            });
        });

		describe('when user notification type is unknown', () => {
			it('should add to the list of generic messages', () => {
				const displayName = 'user1';
				const membershipType = 2;
				const message = {
					sid: '1'
				};
				const notificationType = 'Failsafe';
				const user1 = JSON.parse(JSON.stringify(user));

				Object.assign(user1, { messages: [message] });

				stub.resolves(user);
				mock.expects('upsertDocument').once().withArgs(sinon.match.any, user1).resolves();

				return userService.addUserMessage(displayName, membershipType, message, notificationType)
					.then(() => mock.verify());
			});
		});

		afterEach(() => stub.restore());
	});

    describe('createAnonymousUser', () => {
        let stub;

        beforeEach(() => {
            stub = sinon.stub(userService, 'getUserByDisplayName');
        });

        describe('when anonymous user is invalid', () => {
            it('should reject the anonymous user', () => {
                return userService.createAnonymousUser(_.omit(anonymousUser, 'membershipId'))
                    .catch(err => {
                        expect(err).to.not.be.undefined;
                    });
            });
        });

        describe('when anonymous user is valid', () => {
            describe('when the anonymous user exists', () => {
                it('should reject the anonymous user', () => {
                    stub.resolves(anonymousUser);
                    mock.expects('createDocument').never();

                    return userService.createAnonymousUser(anonymousUser)
                        .catch(() => mock.verify());
                });
            });

            describe('when the anonymous user does not exists', () => {
                it('should reject the anonymous user', () => {
                    stub.resolves();
                    mock.expects('createDocument').once();

                    return userService.createAnonymousUser(anonymousUser)
                        .then(() => {
                            mock.verify();
                        });
                });
            });
        });

        afterEach(() => stub.restore());
    });

    describe('createUser', () => {
        let stub;

        beforeEach(() => {
            stub = sinon.stub(userService, 'getUserByDisplayName');
        });

        describe('when user is invalid', () => {
            it('should reject the user', () => {
                return userService.createUser(_.omit(user, 'phoneNumber'))
                    .catch(err => {
                        expect(err).to.not.be.undefined;
                    });
            });
        });
        describe('when user is valid', () => {
            // ToDo
        });

        afterEach(() => stub.restore());
    });

    describe('getUserByDisplayName', () => {
        describe('when user is cached', () => {
            let mockCache;

            beforeEach(() => {
                mockCache = sinon.mock(cacheService);
            });

            it('should return cached user', () => {
                mockCache.expects('getUser').once().resolves(user);
                mock.expects('getDocuments').never();

                return userService.getUserByDisplayName(user.displayName, user.membershipType)
                    .then(user1 => {
                        expect(user1.displayName).to.equal(user.displayName);
                        mock.verify();
                    });
            });

            afterEach(() => mockCache.restore());
        });

        describe('when display name and membership type are defined', () => {
            it('should return an existing user', () => {
                mock.expects('getDocuments').once().withArgs(sinon.match.any, sinon.match.any).resolves([user]);

                return userService.getUserByDisplayName(user.displayName, user.membershipType)
                    .then(user1 => {
                        expect(user1.displayName).to.equal(user.displayName);
                        mock.verify();
                    });
            });

            it('should fail when more than one existing user is found', () => {
                mock.expects('getDocuments').once().resolves([user, user]);

                return userService.getUserByDisplayName(user.displayName, user.membershipType)
                    .catch(err => {
                        expect(err).to.not.be.undefined;
                        mock.verify();
                    });
            });

            it('should return undefined is user is not found', () => {
                mock.expects('getDocuments').once().resolves([]);

                return userService.getUserByDisplayName(user.displayName, user.membershipType)
                    .then(user1 => {
                        expect(user1).to.be.undefined;
                        mock.verify();
                    });
            });

            it('should fail when display name is empty', () => {
                mock.expects('getDocuments').never();

                return userService.getUserByDisplayName()
                    .catch(err => {
                        expect(err).to.not.be.undefined;
                        mock.verify();
                    });
            });

            it('should fail when membership type is not a number', () => {
                mock.expects('getDocuments').never();

                return userService.getUserByDisplayName(user.displayName, '')
                    .catch(err => {
                        expect(err).to.not.be.undefined;
                        mock.verify();
                    });
            });

            it('should fail when no documents are returned', () => {
                mock.expects('getDocuments').once().resolves(undefined);

                return userService.getUserByDisplayName(user.displayName, user.membershipType)
                    .catch(err => {
                        expect(err).to.not.be.undefined;
                        mock.verify();
                    });
            });
        });
    });

    describe('getUserByEmailAddress', () => {
        describe('when email address and membership type are defined', () => {
            it('should return an existing user', () => {
                mock.expects('getDocuments').once().resolves([user]);

                return userService.getUserByEmailAddress(user.emailAddress)
                    .then(user1 => {
                        expect(user1).to.equal(user);
                        mock.verify();
                    });
            });

            it('should fail when more than one existing user is found', () => {
                mock.expects('getDocuments').once().resolves([user, user]);

                return userService.getUserByEmailAddress(user.emailAddress)
                    .catch(err => {
                        expect(err).to.not.be.undefined;
                        mock.verify();
                    });
            });

            it('should fail when no users are found', () => {
                mock.expects('getDocuments').once().resolves([]);

                return userService.getUserByEmailAddress(user.emailAddress)
                    .then(user1 => {
                        expect(user1).to.be.undefined;
                        mock.verify();
                    });
            });

            it('should fail when email address is empty', () => {
                mock.expects('getDocuments').never();

                return userService.getUserByEmailAddress()
                    .catch(err => {
                        expect(err).to.not.be.undefined;
                        mock.verify();
                    });
            });

            it('should fail when no documents are found', () => {
                mock.expects('getDocuments').once().resolves(undefined);

                return userService.getUserByEmailAddress(user.emailAddress)
                    .catch(err => {
                        expect(err).to.not.be.undefined;
                        mock.verify();
                    });
            });
        });
    });

	describe('getUserById', () => {
		describe('when user id defined', () => {
			it('should return an existing user', () => {
				mock.expects('getDocuments').once().resolves([user]);

				return userService.getUserById(user.id)
					.then(user1 => {
						expect(user1).to.equal(user);
						mock.verify();
					});
			});

			it('should fail when more than one existing user is found', () => {
				mock.expects('getDocuments').once().resolves([user, user]);

				return userService.getUserById(user.id)
					.catch(err => {
						expect(err).to.not.be.undefined;
						mock.verify();
					});
			});

			it('should fail when no users are found', () => {
				mock.expects('getDocuments').once().resolves([]);

				return userService.getUserById(user.id)
					.then(user1 => {
						expect(user1).to.be.undefined;
						mock.verify();
					});
			});

			it('should fail when user id is empty', () => {
				mock.expects('getDocuments').never();

				return userService.getUserById()
					.catch(err => {
						expect(err).to.not.be.undefined;
						mock.verify();
					});
			});

			it('should fail when no documents are found', () => {
				mock.expects('getDocuments').once().resolves(undefined);

				return userService.getUserById(user.id)
					.catch(err => {
						expect(err).to.not.be.undefined;
						mock.verify();
					});
			});
		});
	});

	describe('updateUser', () => {
		let stub;

		beforeEach(() => {
			stub = sinon.stub(userService, 'getUserByDisplayName');
		});

		describe('when user exists', () => {
			describe('and user update is valid', () => {
				it('should resolve undefined', () => {
					const user1 = JSON.parse(JSON.stringify(user));
					user1.firstName = chance.first();

					stub.resolves(user);
					mock.expects('upsertDocument').once().withArgs(sinon.match.any, user1).resolves();

					return userService.updateUser(user1)
						.then(user1 => {
							expect(user1).to.be.undefined;
							mock.verify();
						});
				});
			});

			describe('and user update is invalid', () => {
				it('should fail validation of user schema', () => {
					const user1 = {
						firstName: chance.first()
					};

					stub.resolves(user);
					mock.expects('upsertDocument').never();

					return userService.updateUser(user1)
						.catch(err => {
							expect(err).to.not.be.undefined;
							mock.verify();
						});
				});
			});
		});

		afterEach(() => stub.restore());
	});

	describe('updateUserBungie', () => {
		let stub;

		beforeEach(() => {
			stub = sinon.stub(userService, 'getUserById');
		});

		describe('when user id exists', () => {
			it('should return an existing user', () => {
				const bungie = {};
				const user1 = JSON.parse(JSON.stringify(user));

				Object.assign(user1, { bungie });
				stub.resolves(user);
				mock.expects('upsertDocument').once().withArgs(sinon.match.any, user1).resolves(undefined);

				return userService.updateUserBungie(user.id, bungie)
					.then(user1 => {
						expect(user1).to.be.undefined;
						mock.verify();
					});
			});
		});

		describe('when user id does not exists', () => {
			it('should not modify user document', () => {
				stub.resolves(undefined);
				mock.expects('upsertDocument').never();

				return userService.updateUserBungie(user.id)
					.catch(err => {
						expect(err).to.not.be.undefined;
						mock.verify();
					});
			});
		});

		afterEach(() => stub.restore());
	});

    afterEach(() => mock.restore());
});
