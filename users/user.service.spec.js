/**
 * User Service Tests
 */
import {
    afterEach, beforeEach, describe, expect, it, vi,
} from 'vitest';
import Chance from 'chance';
import cloneDeep from 'lodash/cloneDeep';
import omit from 'lodash/omit';
import UserService from './user.service';

const cacheService = {
    getUser: vi.fn(),
    setUser: vi.fn(),
};
const chance = new Chance();
const documentService = {
    createDocument: vi.fn(),
    deleteDocumentById: vi.fn(),
    getDocuments: vi.fn(),
    updateDocument: vi.fn(),
};

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
    phoneNumber: `+1 ${chance.phone({
        country: 'us',
        formatted: false,
        mobile: true,
    })}`,
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
                        // eslint-disable-next-line constructor-super
                        return super(date);  
                    }

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

    describe('deleteUserMessages', () => {
        describe('when intermediary user messages are found', () => {
            it('should delete intermediary messages only if delivered', async () => {
                const phoneNumber = '+12345678901';
                const messages = [
                    {
                        id: 1,
                        SmsSid: 'A',
                        SmsStatus: 'queued',
                        To: phoneNumber,
                    },
                    {
                        id: 2,
                        SmsSid: 'A',
                        SmsStatus: 'sent',
                        To: phoneNumber,
                    },
                    {
                        id: 3,
                        SmsSid: 'A',
                        SmsStatus: 'delivered',
                        To: phoneNumber,
                    },
                    {
                        id: 4,
                        SmsSid: 'B',
                        SmsStatus: 'queued',
                        To: phoneNumber,
                    },
                ];
                documentService.deleteDocumentById.mockResolvedValue();
                documentService.getDocuments
                    .mockImplementationOnce(() => Promise.resolve(messages.filter(({ SmsStatus }) => SmsStatus !== 'delivered')));
                documentService.getDocuments
                    .mockImplementation(() => Promise.resolve(messages.filter(({ SmsStatus }) => SmsStatus === 'delivered')));

                await userService.deleteUserMessages(phoneNumber);

                expect(documentService.getDocuments).toHaveBeenCalledTimes(3);
                expect(documentService.deleteDocumentById).toHaveBeenCalledTimes(2);
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

            it('should return undefined when no documents are found', async () => {
                documentService.getDocuments.mockImplementation(() => Promise.resolve());

                const user1 = await userService.getUserByMembershipId(user.membershipId);

                expect(user1).toBeUndefined();
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

                const user1 = await userService.getUserById(user.id);

                expect(user1).toBeUndefined();
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
                                .toHaveBeenCalledWith(expect.anything(), user1, user1.membershipType);
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
