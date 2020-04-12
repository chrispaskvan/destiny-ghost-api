/**
 * User Service Tests
 */
const { omit } = require('lodash');
const chance = require('chance')();
const { cloneDeep } = require('lodash');
const CacheService = require('./user.cache');
const UserService = require('./user.service');

jest.mock('./user.cache');

const cacheService = new CacheService();
const documentService = {
    createDocument: jest.fn(),
    getDocuments: jest.fn(),
    upsertDocument: jest.fn(),
};

/**
 * Get the phone number format into the Twilio standard.
 * @param phoneNumber
 * @returns {string}
 * @private
 */
function cleanPhoneNumber(phoneNumber) {
    const cleaned = phoneNumber.replace(/\D/g, '');

    return `+1${cleaned}`;
}

/**
 * Mock Anonymous User
 */
const anonymousUser = {
    displayName: 'displayName1',
    id: '1',
    membershipId: '11',
    membershipType: 2,
    profilePicturePath: '/thing1',
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
            type: 'Xur',
        },
    ],
    phoneNumber: cleanPhoneNumber(chance.phone({
        country: 'us',
        mobile: true,
    })),
};

let userService;

beforeEach(() => {
    userService = new UserService({ cacheService, documentService, client: {} });
});

describe('UserService', () => {
    describe('addUserMessage', () => {
        beforeEach(() => {
            documentService.upsertDocument.mockImplementation(() => Promise.resolve());
            userService.getUserByDisplayName = jest.fn().mockResolvedValue(user);
        });

        describe('when notification type is Xur', () => {
            it('should add message to the list of Xur notifications', () => {
                const displayName = 'user1';
                const membershipType = 2;
                const message = {
                    sid: '1',
                };
                const notificationType = 'Xur';
                const user1 = JSON.parse(JSON.stringify(user));

                Object.assign(user1.notifications[0], { messages: [message] });

                return userService.addUserMessage(displayName, membershipType, message, notificationType) // eslint-disable-line max-len
                    .then(() => {
                        expect(documentService.upsertDocument).toHaveBeenCalledWith('Users', user1);
                    });
            });
        });

        describe('when user has no previous messages of the notification type', () => {
            it('should create a new list of this notification type', () => {
                const displayName = 'user1';
                const membershipType = 2;
                const message = {
                    sid: '1',
                };
                const notificationType = 'Banshee-44';
                const user1 = JSON.parse(JSON.stringify(user));

                user1.notifications.push({
                    enabled: false,
                    type: notificationType,
                    messages: [message],
                });

                return userService.addUserMessage(displayName, membershipType, message, notificationType) // eslint-disable-line max-len
                    .then(() => {
                        expect(documentService.upsertDocument).toHaveBeenCalledWith('Users', user1);
                    });
            });
        });

        describe('when user notification type is unknown', () => {
            it('should add to the list of generic messages', () => {
                const displayName = 'user1';
                const membershipType = 2;
                const message = {
                    sid: '1',
                };
                const notificationType = 'Failsafe';
                const user1 = JSON.parse(JSON.stringify(user));

                Object.assign(user1, { messages: [message] });

                return userService.addUserMessage(displayName, membershipType, message, notificationType) // eslint-disable-line max-len
                    .then(() => {
                        expect(documentService.upsertDocument).toHaveBeenCalledWith('Users', user1);
                    });
            });
        });
    });

    describe('createAnonymousUser', () => {
        beforeEach(() => {
            documentService.createDocument.mockImplementation(() => Promise.resolve());
            documentService.upsertDocument.mockImplementation(() => Promise.resolve());
        });

        describe('when anonymous user is invalid', () => {
            it('should reject the anonymous user', () => {
                userService.getUserByDisplayName = jest.fn().mockResolvedValue(anonymousUser);

                return userService.createAnonymousUser(omit(anonymousUser, 'membershipId'))
                    .catch(err => {
                        expect(err).toBeDefined();
                    });
            });
        });

        describe('when anonymous user is valid', () => {
            describe('when the anonymous user exists', () => {
                it('should reject the anonymous user', () => {
                    userService.getUserByDisplayName = jest.fn().mockResolvedValue(anonymousUser);

                    return userService.createAnonymousUser(anonymousUser)
                        .catch(() => {
                            expect(documentService.createDocument).not.toHaveBeenCalled();
                        });
                });
            });

            describe('when the anonymous user does not exists', () => {
                it('should create the anonymous user', () => {
                    userService.getUserByDisplayName = jest.fn().mockResolvedValue();

                    return userService.createAnonymousUser(anonymousUser)
                        .then(() => {
                            expect(documentService.createDocument).toHaveBeenCalled();
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
            it('should reject the user', () => userService.createUser(omit(user, 'phoneNumber'))
                .catch(err => {
                    expect(err).toBeDefined();
                }));
        });

        describe('when user is valid', () => {
            // ToDo
        });
    });

    describe('getUserByDisplayName', () => {
        describe('when user is cached', () => {
            it('should return cached user', () => {
                cacheService.getUser.mockImplementation(() => Promise.resolve(user));

                return userService.getUserByDisplayName(user.displayName, user.membershipType)
                    .then(user1 => {
                        expect(cacheService.getUser).toHaveBeenCalled();
                        expect(user1.displayName).toEqual(user.displayName);
                        expect(documentService.getDocuments).not.toHaveBeenCalled();
                    });
            });
        });

        describe('when display name and membership type are defined', () => {
            it('should return an existing user', () => {
                cacheService.getUser.mockImplementation(() => Promise.resolve());
                documentService.getDocuments.mockImplementation(() => Promise.resolve([user]));

                return userService.getUserByDisplayName(user.displayName, user.membershipType)
                    .then(user1 => {
                        expect(user1.displayName).toEqual(user.displayName);
                        expect(documentService.getDocuments).toHaveBeenCalled();
                    });
            });

            it('should fail when more than one existing user is found', () => {
                documentService.getDocuments
                    .mockImplementation(() => Promise.resolve([user, user]));

                return userService.getUserByDisplayName(user.displayName, user.membershipType)
                    .catch(err => {
                        expect(err).toBeDefined();
                        expect(documentService.getDocuments).toHaveBeenCalled();
                    });
            });

            it('should return undefined if user is not found', () => {
                documentService.getDocuments.mockImplementation(() => Promise.resolve([]));

                return userService.getUserByDisplayName('unknownDisplayName', user.membershipType)
                    .then(user1 => {
                        expect(user1).toBeUndefined();
                        expect(documentService.getDocuments).toHaveBeenCalled();
                    });
            });

            it('should fail when display name is empty', () => userService.getUserByDisplayName()
                .catch(err => {
                    expect(err).toBeDefined();
                }));

            it('should fail when membership type is not a number', () => userService.getUserByDisplayName(user.displayName, '')
                .catch(err => {
                    expect(err).toBeDefined();
                }));

            it('should fail when no documents are returned', () => {
                documentService.getDocuments.mockImplementation(() => Promise.resolve());

                return userService.getUserByDisplayName(user.displayName, user.membershipType)
                    .catch(err => {
                        expect(err).toBeDefined();
                        expect(documentService.getDocuments).toHaveBeenCalled();
                    });
            });
        });
    });

    describe('getUserByEmailAddress', () => {
        describe('when email address and membership type are defined', () => {
            it('should return an existing user', () => {
                documentService.getDocuments.mockImplementation(() => Promise.resolve([user]));

                return userService.getUserByEmailAddress(user.emailAddress)
                    .then(user1 => {
                        expect(user1).toEqual(user);
                        expect(documentService.getDocuments).toHaveBeenCalled();
                    });
            });

            it('should fail when more than one existing user is found', () => {
                documentService.getDocuments
                    .mockImplementation(() => Promise.resolve([user, user]));

                return userService.getUserByEmailAddress(user.emailAddress)
                    .catch(err => {
                        expect(err).toBeDefined();
                        expect(documentService.getDocuments).toHaveBeenCalled();
                    });
            });

            it('should fail when no users are found', () => {
                documentService.getDocuments.mockImplementation(() => Promise.resolve([]));

                return userService.getUserByEmailAddress(user.emailAddress)
                    .then(user1 => {
                        expect(user1).toBeUndefined();
                        expect(documentService.getDocuments).toHaveBeenCalled();
                    });
            });

            it('should fail when email address is empty', () => {
                documentService.getDocuments.mockImplementation(() => Promise.resolve());

                return userService.getUserByEmailAddress()
                    .catch(err => {
                        expect(err).toBeDefined();
                        expect(documentService.getDocuments).not.toHaveBeenCalled();
                    });
            });

            it('should fail when no documents are found', () => {
                documentService.getDocuments.mockImplementation(() => Promise.resolve());

                return userService.getUserByEmailAddress(user.emailAddress)
                    .catch(err => {
                        expect(err).toBeDefined();
                        expect(documentService.getDocuments).toHaveBeenCalled();
                    });
            });
        });
    });

    describe('getUserById', () => {
        describe('when user id defined', () => {
            it('should return an existing user', () => {
                documentService.getDocuments.mockImplementation(() => Promise.resolve([user]));

                return userService.getUserById(user.id)
                    .then(user1 => {
                        expect(user1).toEqual(user);
                        expect(documentService.getDocuments).toHaveBeenCalled();
                    });
            });

            it('should fail when more than one existing user is found', () => {
                documentService.getDocuments
                    .mockImplementation(() => Promise.resolve([user, user]));

                return userService.getUserById(user.id)
                    .catch(err => {
                        expect(err).toBeDefined();
                        expect(documentService.getDocuments).toHaveBeenCalled();
                    });
            });

            it('should fail when no users are found', () => {
                documentService.getDocuments.mockImplementation(() => Promise.resolve([]));

                return userService.getUserById(user.id)
                    .then(user1 => {
                        expect(user1).toBeUndefined();
                        expect(documentService.getDocuments).toHaveBeenCalled();
                    });
            });

            it('should fail when user id is empty', () => {
                documentService.getDocuments.mockImplementation(() => Promise.resolve());

                return userService.getUserById()
                    .catch(err => {
                        expect(err).toBeDefined();
                        expect(documentService.getDocuments).not.toHaveBeenCalled();
                    });
            });

            it('should fail when no documents are found', () => {
                documentService.getDocuments.mockImplementation(() => Promise.resolve());

                return userService.getUserById(user.id)
                    .catch(err => {
                        expect(err).toBeDefined();
                        expect(documentService.getDocuments).toHaveBeenCalled();
                    });
            });
        });
    });

    describe('updateUser', () => {
        describe('when user exists', () => {
            describe('and user update is valid', () => {
                it('should resolve undefined', () => {
                    const user1 = cloneDeep(user);
                    documentService.upsertDocument.mockImplementation(() => Promise.resolve());

                    user1.firstName = chance.first();

                    userService.getUserByDisplayName = jest.fn().mockResolvedValue(user);

                    return userService.updateUser(user1)
                        .then(user2 => {
                            expect(user2).toBeUndefined();
                            expect(documentService.upsertDocument)
                                .toHaveBeenCalledWith(expect.anything(), user1);
                        });
                });
            });

            describe('and user update is invalid', () => {
                it('should fail validation of user schema', () => {
                    const user1 = {
                        firstName: chance.first(),
                    };

                    documentService.upsertDocument.mockImplementation(() => Promise.resolve());
                    userService.getUserByDisplayName = jest.fn().mockResolvedValue();

                    return userService.updateUser(user1)
                        .catch(err => {
                            expect(err).toBeDefined();
                            expect(documentService.upsertDocument).not.toHaveBeenCalled();
                        });
                });
            });
        });
    });

    describe('updateUserBungie', () => {
        describe('when user id exists', () => {
            it('should return undefined', () => {
                documentService.upsertDocument
                    .mockImplementation(() => Promise.resolve());

                userService.getUserById = jest.fn().mockResolvedValue(user);

                return userService.updateUserBungie(user.id, {})
                    .then(user1 => {
                        expect(user1).toBeUndefined();
                        expect(documentService.upsertDocument)
                            .toHaveBeenCalledWith(expect.anything(), user);
                    });
            });
        });

        describe('when user id does not exist', () => {
            it('should not modify user document', () => {
                documentService.upsertDocument
                    .mockImplementation(() => Promise.resolve());

                userService.getUserById = jest.fn().mockResolvedValue();

                return userService.updateUserBungie(user.id)
                    .catch(err => {
                        expect(err).toBeDefined();
                        expect(documentService.upsertDocument).not.toHaveBeenCalled();
                    });
            });
        });
    });

    afterEach(() => jest.clearAllMocks());
});
