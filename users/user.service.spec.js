/**
 * User Service Tests
 */
const _ = require('underscore'),
    UserService = require('./user.service'),
    chance = require('chance')(),
    documentService = require('../helpers/documents'),
	{ cloneDeep } = require('lodash');

jest.mock('../helpers/documents');

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
    getUser: jest.fn(),
	setUser: jest.fn()
};

let userService;

beforeEach(() => {
    userService = new UserService({ cacheService, documentService });
});

describe('UserService', () => {
    let mock;

    describe('addUserMessage', () => {
        beforeEach(() => {
	        mock = documentService.upsertDocument.mockImplementation(() => Promise.resolve());
	        userService.getUserByDisplayName = jest.fn().mockResolvedValue(user);
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

                return userService.addUserMessage(displayName, membershipType, message, notificationType)
                    .then(() => {
						expect(mock).toBeCalledWith('Users', user1);
                    });
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

				return userService.addUserMessage(displayName, membershipType, message, notificationType)
					.then(() => {
						expect(mock).toBeCalledWith('Users', user1);
					});
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

				return userService.addUserMessage(displayName, membershipType, message, notificationType)
					.then(() => {
						expect(mock).toBeCalledWith('Users', user1);
					});
			});
		});
	});

    describe('createAnonymousUser', () => {
	    beforeEach(() => {
		    mock = documentService.createDocument.mockImplementation(() => Promise.resolve());
	    });

        describe('when anonymous user is invalid', () => {
            it('should reject the anonymous user', () => {
	            userService.getUserByDisplayName = jest.fn().mockResolvedValue(anonymousUser);

                return userService.createAnonymousUser(_.omit(anonymousUser, 'membershipId'))
                    .catch(err => {
                        expect(err).not.toBeUndefined;
                    });
            });
        });

        describe('when anonymous user is valid', () => {
            describe('when the anonymous user exists', () => {
                it('should reject the anonymous user', () => {
	                userService.getUserByDisplayName = jest.fn().mockResolvedValue(anonymousUser);

                    return userService.createAnonymousUser(anonymousUser)
                        .catch(() => {
	                        expect(mock).not.toHaveBeenCalled();
                        });
                });
            });

            describe('when the anonymous user does not exists', () => {
                it('should reject the anonymous user', () => {
	                userService.getUserByDisplayName = jest.fn().mockResolvedValue();

                    return userService.createAnonymousUser(anonymousUser)
                        .then(() => {
                        	expect(mock).toHaveBeenCalledTimes(1);
                        });
                });
            });
        });
    });

    describe('createUser', () => {
    	beforeEach(() => {
		    userService.getUserByDisplayName = jest.fn().mockResolvedValue(anonymousUser);
        });

        describe('when user is invalid', () => {
            it('should reject the user', () => {
                return userService.createUser(_.omit(user, 'phoneNumber'))
                    .catch(err => {
                        expect(err).not.toBeUndefined;
                    });
            });
        });
        describe('when user is valid', () => {
            // ToDo
        });
    });

    describe('getUserByDisplayName', () => {
        describe('when user is cached', () => {
            beforeEach(() => {
	            cacheService.getUser = jest.fn().mockResolvedValue(user);
            });

            it('should return cached user', () => {
                return userService.getUserByDisplayName(user.displayName, user.membershipType)
                    .then(user1 => {
	                    expect(cacheService.getUser).toHaveBeenCalled();
	                    expect(user1.displayName).toEqual(user.displayName);
                    });
            });
        });

        describe('when display name and membership type are defined', () => {
            it('should return an existing user', () => {
	            documentService.getDocuments.mockImplementation(() => Promise.resolve([user]));

                return userService.getUserByDisplayName(user.displayName, user.membershipType)
                    .then(user1 => {
                        expect(user1.displayName).toEqual(user.displayName);
                    });
            });

            it('should fail when more than one existing user is found', () => {
	            documentService.getDocuments.mockImplementation(() => Promise.resolve([user, user]));

                return userService.getUserByDisplayName(user.displayName, user.membershipType)
                    .catch(err => {
                        expect(err).not.toBeUndefined;
                    });
            });

            it('should return undefined is user is not found', () => {
	            documentService.getDocuments.mockImplementation(() => Promise.resolve([]));

                return userService.getUserByDisplayName(user.displayName, user.membershipType)
                    .then(user1 => {
                        expect(user1).toBeUndefined;
                    });
            });

            it('should fail when display name is empty', () => {
                return userService.getUserByDisplayName()
                    .catch(err => {
                        expect(err).not.toBeUndefined;
                    });
            });

            it('should fail when membership type is not a number', () => {
                return userService.getUserByDisplayName(user.displayName, '')
                    .catch(err => {
                        expect(err).not.toBeUndefined;
                    });
            });

            it('should fail when no documents are returned', () => {
	            documentService.getDocuments.mockImplementation(() => Promise.resolve(undefined));

                return userService.getUserByDisplayName(user.displayName, user.membershipType)
                    .catch(err => {
	                    expect(err).not.toBeUndefined;
                    });
            });
        });
    });

    describe('getUserByEmailAddress', () => {
	    beforeEach(() => {
		    documentService.getDocuments.mockClear();
	    });

	    describe('when email address and membership type are defined', () => {
            it('should return an existing user', () => {
	            const mock = documentService.getDocuments.mockImplementation(() => Promise.resolve([user]));

                return userService.getUserByEmailAddress(user.emailAddress)
                    .then(user1 => {
                        expect(user1).toEqual(user);
	                    expect(mock).toHaveBeenCalled();
                    });
            });

            it('should fail when more than one existing user is found', () => {
	            const mock = documentService.getDocuments.mockImplementation(() => Promise.resolve([user, user]));

                return userService.getUserByEmailAddress(user.emailAddress)
                    .catch(err => {
	                    expect(err).not.toBeUndefined;
	                    expect(mock).toHaveBeenCalled();
                    });
            });

            it('should fail when no users are found', () => {
	            const mock = documentService.getDocuments.mockImplementation(() => Promise.resolve([]));

                return userService.getUserByEmailAddress(user.emailAddress)
                    .then(user1 => {
	                    expect(user1).toBeUndefined;
	                    expect(mock).toHaveBeenCalled();
                    });
            });

            it('should fail when email address is empty', () => {
	            const mock = documentService.getDocuments.mockImplementation();

                return userService.getUserByEmailAddress()
                    .catch(err => {
	                    expect(err).not.toBeUndefined;
	                    expect(mock).not.toHaveBeenCalled();
                    });
            });

            it('should fail when no documents are found', () => {
	            const mock = documentService.getDocuments.mockImplementation(() => Promise.resolve());

                return userService.getUserByEmailAddress(user.emailAddress)
                    .catch(err => {
	                    expect(err).not.toBeUndefined;
	                    expect(mock).toHaveBeenCalled();
                    });
            });
        });
    });

	describe('getUserById', () => {
		beforeEach(() => {
			documentService.getDocuments.mockClear();
		});

		describe('when user id defined', () => {
			it('should return an existing user', () => {
				const mock = documentService.getDocuments.mockImplementation(() => Promise.resolve([user]));

				return userService.getUserById(user.id)
					.then(user1 => {
						expect(user1).toEqual(user);
						expect(mock).toHaveBeenCalled();
					});
			});

			it('should fail when more than one existing user is found', () => {
				const mock = documentService.getDocuments.mockImplementation(() => Promise.resolve([user, user]));

				return userService.getUserById(user.id)
					.catch(err => {
						expect(err).not.toBeUndefined;
						expect(mock).toHaveBeenCalled();
					});
			});

			it('should fail when no users are found', () => {
				const mock = documentService.getDocuments.mockImplementation(() => Promise.resolve([]));

				return userService.getUserById(user.id)
					.then(user1 => {
						expect(user1).toBeUndefined;
						expect(mock).toHaveBeenCalled();
					});
			});

			it('should fail when user id is empty', () => {
				const mock = documentService.getDocuments.mockImplementation();

				return userService.getUserById()
					.catch(err => {
						expect(err).not.toBeUndefined;
						expect(mock).not.toHaveBeenCalled();
					});
			});

			it('should fail when no documents are found', () => {
				const mock = documentService.getDocuments.mockImplementation(() => Promise.resolve());

				return userService.getUserById(user.id)
					.catch(err => {
						expect(err).not.toBeUndefined;
						expect(mock).toHaveBeenCalled();
					});
			});
		});
	});

	describe('updateUser', () => {
		beforeEach(() => {
			documentService.upsertDocument.mockClear();
		});

		describe('when user exists', () => {
			describe('and user update is valid', () => {
				it('should resolve undefined', () => {
					const mock = documentService.upsertDocument.mockImplementation(() => Promise.resolve());
					const user1 = cloneDeep(user);

					user1.firstName = chance.first();
					userService.getUserByDisplayName = jest.fn().mockResolvedValue(user);

					return userService.updateUser(user1)
						.then(user2 => {
							expect(user2).toBeUndefined;
							expect(mock).toBeCalledWith(expect.anything(), user1);
						});
				});
			});

			describe('and user update is invalid', () => {
				it('should fail validation of user schema', () => {
					const mock = documentService.upsertDocument.mockImplementation(() => Promise.resolve());
					const user1 = {
						firstName: chance.first()
					};

					userService.getUserByDisplayName = jest.fn().mockResolvedValue();

					return userService.updateUser(user1)
						.catch(err => {
							expect(err).not.toBeUndefined;
							expect(mock).not.toHaveBeenCalled();
						});
				});
			});
		});
	});

	describe('updateUserBungie', () => {
		beforeEach(() => {
			documentService.upsertDocument.mockClear();
		});

		describe('when user id exists', () => {
			it('should return undefined', () => {
				const mock = documentService.upsertDocument.mockImplementation(() => Promise.resolve());

				userService.getUserById = jest.fn().mockResolvedValue(user);

				return userService.updateUserBungie(user.id, {})
					.then(user1 => {
						expect(user1).toBeUndefined;
						expect(mock).toBeCalledWith(expect.anything(), user);
					});
			});
		});

		describe('when user id does not exists', () => {
			it('should not modify user document', () => {
				const mock = documentService.upsertDocument.mockImplementation(() => Promise.resolve());

				userService.getUserById = jest.fn().mockResolvedValue();

				return userService.updateUserBungie(user.id)
					.catch(err => {
						expect(err).toBeUndefined;
						expect(mock).not.toHaveBeenCalled();
					});
			});
		});
	});
});
