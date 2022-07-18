/**
 * User Service Tests
 */
import {
    afterEach, beforeEach, describe, expect, it, vi,
} from 'vitest';
import lodash from 'lodash';
import Chance from 'chance';
import UserService from './user.service';

const { cloneDeep, omit } = lodash;
const cacheService = {
    getUser: vi.fn(),
    setUser: vi.fn(),
};
const chance = new Chance();
const documentService = {
    createDocument: vi.fn(),
    getDocuments: vi.fn(),
    updateDocument: vi.fn(),
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
    beforeEach(() => {
        vi.clearAllMocks();
    });

    describe('addUserMessage', () => {
        let currentDate;
        let realDate;

        beforeEach(() => {
            realDate = Date;
            global.Date = class extends Date {
                constructor(date) {
                    if (date) {
                        return super(date); // eslint-disable-line constructor-super, max-len, no-constructor-return
                    }

                    // eslint-disable-next-line no-constructor-return
                    return currentDate;
                }
            };

            documentService.updateDocument.mockImplementation(() => Promise.resolve());
            userService.getUserByDisplayName = vi.fn().mockResolvedValue(user);
        });
        afterEach(() => {
            global.Date = realDate;
        });

        it('should add the message to the database collection', async () => {
            const currentDateAsString = '2020-04-25T18:00:00.000Z';
            const message = {
                SmsSid: 'SM11',
                SmsStatus: 'sent',
                To: '+1234567890',
            };

            currentDate = new Date(currentDateAsString);

            await userService.addUserMessage(message);

            expect(documentService.createDocument).toHaveBeenCalledWith('Messages', {
                DateTime: currentDateAsString,
                ...message,
            });
        });
    });

    describe('createAnonymousUser', () => {
        beforeEach(() => {
            documentService.createDocument.mockImplementation(() => Promise.resolve());
            documentService.updateDocument.mockImplementation(() => Promise.resolve());
        });

        describe('when anonymous user is invalid', () => {
            it('should reject the anonymous user', async () => {
                userService.getUserByDisplayName = vi.fn().mockResolvedValue(anonymousUser);

                await expect(userService.createAnonymousUser(omit(anonymousUser, 'membershipId')))
                    .rejects.toThrow(undefined);
            });
        });

        describe('when anonymous user is valid', () => {
            describe('when the anonymous user exists', () => {
                it('should reject the anonymous user', async () => {
                    userService.getUserByDisplayName = vi.fn().mockResolvedValue(anonymousUser);

                    await expect(userService.createAnonymousUser(anonymousUser)).rejects.toThrow();

                    expect(documentService.createDocument).not.toHaveBeenCalled();
                });
            });

            describe('when the anonymous user does not exists', () => {
                it('should create the anonymous user', () => {
                    userService.getUserByDisplayName = vi.fn().mockResolvedValue();

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
            userService.getUserByDisplayName = vi.fn().mockResolvedValue(anonymousUser);
        });

        describe('when user is invalid', () => {
            it('should reject the user', async () => {
                await expect(userService.createUser(omit(user, 'phoneNumber'))).rejects.toThrow(undefined);
            });
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

        describe('when display name and membership type are not valid', () => {
            it('should throw', async () => {
                await expect(userService
                    .getUserByDisplayName(user.membershipType, user.displayName))
                    .rejects.toThrow('"displayName" must be a string. "membershipType" must be a number');
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

            it('should fail when more than one existing user is found', async () => {
                documentService.getDocuments
                    .mockImplementation(() => Promise.resolve([user, user]));

                // eslint-disable-next-line max-len
                await expect(userService.getUserByDisplayName(user.displayName, user.membershipType))
                    .rejects.toThrow();

                expect(documentService.getDocuments).toHaveBeenCalled();
            });

            it('should return undefined if user is not found', () => {
                documentService.getDocuments.mockImplementation(() => Promise.resolve([]));

                return userService.getUserByDisplayName('unknownDisplayName', user.membershipType)
                    .then(user1 => {
                        expect(user1).toBeUndefined();
                        expect(documentService.getDocuments).toHaveBeenCalled();
                    });
            });

            it('should fail when display name is empty', async () => {
                await expect(userService.getUserByDisplayName()).rejects.toThrow();
            });

            it('should fail when membership type is not a number', async () => {
                await expect(userService.getUserByDisplayName(user.displayName, '')).rejects.toThrow();
            });

            it('should fail when no documents are returned', async () => {
                documentService.getDocuments.mockImplementation(() => Promise.resolve());

                // eslint-disable-next-line max-len
                await expect(userService.getUserByDisplayName(user.displayName, user.membershipType))
                    .rejects.toThrow();

                expect(documentService.getDocuments).toHaveBeenCalled();
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

            it('should fail when more than one existing user is found', async () => {
                documentService.getDocuments
                    .mockImplementation(() => Promise.resolve([user, user]));

                await expect(userService.getUserByEmailAddress(user.emailAddress))
                    .rejects.toThrow();

                expect(documentService.getDocuments).toHaveBeenCalled();
            });

            it('should fail when no users are found', () => {
                documentService.getDocuments.mockImplementation(() => Promise.resolve([]));

                return userService.getUserByEmailAddress(user.emailAddress)
                    .then(user1 => {
                        expect(user1).toBeUndefined();
                        expect(documentService.getDocuments).toHaveBeenCalled();
                    });
            });

            it('should fail when email address is empty', async () => {
                documentService.getDocuments.mockImplementation(() => Promise.resolve());

                await expect(userService.getUserByEmailAddress())
                    .rejects.toThrow();

                expect(documentService.getDocuments).not.toHaveBeenCalled();
            });

            it('should fail when no documents are found', async () => {
                documentService.getDocuments.mockImplementation(() => Promise.resolve());

                await expect(userService.getUserByEmailAddress(user.emailAddress))
                    .rejects.toThrow();

                expect(documentService.getDocuments).toHaveBeenCalled();
            });
        });
    });

    describe('getUserByEmailAddressToken', () => {
        describe('when email address token is defined', () => {
            it('should return an existing user', () => {
                documentService.getDocuments.mockImplementation(() => Promise.resolve([user]));

                return userService.getUserByEmailAddressToken('some_token')
                    .then(user1 => {
                        expect(user1).toEqual(user);
                        expect(documentService.getDocuments).toHaveBeenCalled();
                    });
            });

            it('should fail when more than one existing user is found', async () => {
                documentService.getDocuments
                    .mockImplementation(() => Promise.resolve([user, user]));

                await expect(userService.getUserByEmailAddressToken('some_token'))
                    .rejects.toThrow();

                expect(documentService.getDocuments).toHaveBeenCalled();
            });

            it('should fail when no users are found', () => {
                documentService.getDocuments.mockImplementation(() => Promise.resolve([]));

                return userService.getUserByEmailAddressToken('some_token')
                    .then(user1 => {
                        expect(user1).toBeUndefined();
                        expect(documentService.getDocuments).toHaveBeenCalled();
                    });
            });

            it('should fail when email address token is empty', async () => {
                documentService.getDocuments.mockImplementation(() => Promise.resolve());

                await expect(userService.getUserByEmailAddressToken())
                    .rejects.toThrow();

                expect(documentService.getDocuments).not.toHaveBeenCalled();
            });

            it('should fail when no documents are found', async () => {
                documentService.getDocuments.mockImplementation(() => Promise.resolve());

                await expect(userService.getUserByEmailAddressToken('some_token'))
                    .rejects.toThrow();

                expect(documentService.getDocuments).toHaveBeenCalled();
            });
        });
    });

    describe('getUserByMembershipId', () => {
        describe('when membership Id is defined', () => {
            it('should return an existing user', () => {
                documentService.getDocuments.mockImplementation(() => Promise.resolve([user]));

                return userService.getUserByMembershipId(user.membershipId)
                    .then(user1 => {
                        expect(user1).toEqual(user);
                        expect(documentService.getDocuments).toHaveBeenCalled();
                    });
            });

            it('should fail when more than one existing user is found', async () => {
                documentService.getDocuments
                    .mockImplementation(() => Promise.resolve([user, user]));

                await expect(userService.getUserByMembershipId(user.membershipId))
                    .rejects.toThrow();

                expect(documentService.getDocuments).toHaveBeenCalled();
            });

            it('should fail when no users are found', () => {
                documentService.getDocuments.mockImplementation(() => Promise.resolve([]));

                return userService.getUserByMembershipId(user.membershipId)
                    .then(user1 => {
                        expect(user1).toBeUndefined();
                        expect(documentService.getDocuments).toHaveBeenCalled();
                    });
            });

            it('should fail when email address is empty', async () => {
                documentService.getDocuments.mockImplementation(() => Promise.resolve());

                await expect(userService.getUserByMembershipId())
                    .rejects.toThrow();

                expect(documentService.getDocuments).not.toHaveBeenCalled();
            });

            it('should fail when no documents are found', async () => {
                documentService.getDocuments.mockImplementation(() => Promise.resolve());

                await expect(userService.getUserByMembershipId(user.membershipId))
                    .rejects.toThrow();

                expect(documentService.getDocuments).toHaveBeenCalled();
            });
        });
    });

    describe('getUserByPhoneNumber', () => {
        describe('when user is cached', () => {
            it('should return cached user', () => {
                cacheService.getUser.mockImplementationOnce(() => Promise.resolve(user));

                return userService.getUserByPhoneNumber(user.phoneNumber)
                    .then(user1 => {
                        expect(cacheService.getUser).toHaveBeenCalled();
                        expect(user1.displayName).toEqual(user.displayName);
                        expect(documentService.getDocuments).not.toHaveBeenCalled();
                    });
            });
        });

        describe('when phone number is found', () => {
            it('should return an existing user', () => {
                documentService.getDocuments.mockImplementation(() => Promise.resolve([user]));

                return userService.getUserByPhoneNumber(user.phoneNumber)
                    .then(user1 => {
                        expect(user1).toEqual(user);
                        expect(documentService.getDocuments).toHaveBeenCalled();
                    });
            });

            it('should fail when more than one existing user is found', async () => {
                documentService.getDocuments
                    .mockImplementation(() => Promise.resolve([user, user]));

                await expect(userService.getUserByPhoneNumber(user.phoneNumber))
                    .rejects.toThrow();

                expect(documentService.getDocuments).toHaveBeenCalled();
            });

            it('should fail when no users are found', () => {
                documentService.getDocuments.mockImplementation(() => Promise.resolve([]));

                return userService.getUserByPhoneNumber(user.phoneNumber)
                    .then(user1 => {
                        expect(user1).toBeUndefined();
                        expect(documentService.getDocuments).toHaveBeenCalled();
                    });
            });

            it('should fail when phone number is empty', async () => {
                documentService.getDocuments.mockImplementation(() => Promise.resolve());

                await expect(userService.getUserByPhoneNumber())
                    .rejects.toThrow();

                expect(documentService.getDocuments).not.toHaveBeenCalled();
            });

            it('should fail when no documents are found', async () => {
                documentService.getDocuments.mockImplementation(() => Promise.resolve());

                await expect(userService.getUserByPhoneNumber(user.phoneNumber))
                    .rejects.toThrow();

                expect(documentService.getDocuments).toHaveBeenCalled();
            });
        });
    });

    describe('getUserByPhoneNumberToken', () => {
        describe('when phone number token is found', () => {
            it('should return an existing user', () => {
                documentService.getDocuments.mockImplementation(() => Promise.resolve([user]));

                return userService.getUserByPhoneNumberToken(1)
                    .then(user1 => {
                        expect(user1).toEqual(user);
                        expect(documentService.getDocuments).toHaveBeenCalled();
                    });
            });

            it('should fail when more than one existing user is found', async () => {
                documentService.getDocuments
                    .mockImplementation(() => Promise.resolve([user, user]));

                await expect(userService.getUserByPhoneNumberToken(1))
                    .rejects.toThrow();

                expect(documentService.getDocuments).toHaveBeenCalled();
            });

            it('should fail when no users are found', () => {
                documentService.getDocuments.mockImplementation(() => Promise.resolve([]));

                return userService.getUserByPhoneNumberToken(1)
                    .then(user1 => {
                        expect(user1).toBeUndefined();
                        expect(documentService.getDocuments).toHaveBeenCalled();
                    });
            });

            it('should fail when phone number is empty', async () => {
                documentService.getDocuments.mockImplementation(() => Promise.resolve());

                await expect(userService.getUserByPhoneNumberToken())
                    .rejects.toThrow();

                expect(documentService.getDocuments).not.toHaveBeenCalled();
            });

            it('should fail when no documents are found', async () => {
                documentService.getDocuments.mockImplementation(() => Promise.resolve());

                await expect(userService.getUserByPhoneNumberToken(1))
                    .rejects.toThrow();

                expect(documentService.getDocuments).toHaveBeenCalled();
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

            it('should fail when more than one existing user is found', async () => {
                documentService.getDocuments
                    .mockImplementation(() => Promise.resolve([user, user]));

                await expect(userService.getUserById(user.id))
                    .rejects.toThrow();

                expect(documentService.getDocuments).toHaveBeenCalled();
            });

            it('should fail when no users are found', () => {
                documentService.getDocuments.mockImplementation(() => Promise.resolve([]));

                return userService.getUserById(user.id)
                    .then(user1 => {
                        expect(user1).toBeUndefined();
                        expect(documentService.getDocuments).toHaveBeenCalled();
                    });
            });

            it('should fail when user id is empty', async () => {
                documentService.getDocuments.mockImplementation(() => Promise.resolve());

                await expect(userService.getUserById())
                    .rejects.toThrow();

                expect(documentService.getDocuments).not.toHaveBeenCalled();
            });

            it('should fail when no documents are found', async () => {
                documentService.getDocuments.mockImplementation(() => Promise.resolve());

                await expect(userService.getUserById(user.id))
                    .rejects.toThrow();

                expect(documentService.getDocuments).toHaveBeenCalled();
            });
        });
    });

    describe('updateUser', () => {
        describe('when user exists', () => {
            describe('and user update is valid', () => {
                it('should resolve undefined', () => {
                    const user1 = cloneDeep(user);
                    documentService.updateDocument.mockImplementation(() => Promise.resolve());

                    user1.firstName = chance.first();

                    userService.getUserByDisplayName = vi.fn().mockResolvedValue(user);

                    return userService.updateUser(user1)
                        .then(user2 => {
                            expect(user2).toBeUndefined();
                            expect(documentService.updateDocument)
                                .toHaveBeenCalledWith(expect.anything(), user1);
                        });
                });
            });

            describe('and user update is invalid', () => {
                it('should fail validation of user schema', async () => {
                    const user1 = {
                        firstName: chance.first(),
                    };

                    documentService.updateDocument.mockImplementation(() => Promise.resolve());
                    userService.getUserByDisplayName = vi.fn().mockResolvedValue();

                    await expect(userService.updateUser(user1))
                        .rejects.toThrow();

                    expect(documentService.updateDocument).not.toHaveBeenCalled();
                });
            });
        });
    });

    describe('updateUserBungie', () => {
        describe('when user id exists', () => {
            it('should return undefined', () => {
                documentService.updateDocument
                    .mockImplementation(() => Promise.resolve());

                userService.getUserById = vi.fn().mockResolvedValue(user);

                return userService.updateUserBungie(user.id, {})
                    .then(user1 => {
                        expect(user1).toBeUndefined();
                        expect(documentService.updateDocument)
                            .toHaveBeenCalledWith(expect.anything(), user);
                    });
            });
        });

        describe('when user id does not exist', () => {
            it('should not modify user document', async () => {
                documentService.updateDocument
                    .mockImplementation(() => Promise.resolve());

                userService.getUserById = vi.fn().mockResolvedValue();

                await expect(userService.updateUserBungie(user.id))
                    .rejects.toThrow();

                expect(documentService.updateDocument).not.toHaveBeenCalled();
            });
        });
    });
});
