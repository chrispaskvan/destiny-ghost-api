import {
    beforeEach, describe, expect, it, vi,
} from 'vitest';
import Chance from 'chance';
import UserController from './user.controller';

vi.mock('../helpers/postmaster', () => ({
    default: vi.fn().mockReturnValue({
        register: vi.fn(),
    }),
}));

const chance = new Chance();
const displayName = chance.name();
const membershipId = chance.integer().toString();
const membershipType = chance.integer({ min: 1, max: 2 });
const phoneNumber = '3636598203';
const mockUser = {
    displayName,
    membershipId,
    membershipType,
    profilePicturePath: 'some-profile-picture-path',
};
const destinyService = {
    getAccessTokenFromCode: vi.fn(),
    getCurrentUser: vi.fn(),
};
const notificationService = {
    sendMessage: vi.fn().mockResolvedValue(),
};
const userService = {
    createAnonymousUser: vi.fn().mockImplementation(user => Promise.resolve(user)),
    deleteUserMessages: vi.fn().mockResolvedValue(),
    getCurrentUser: vi.fn(),
    getUserByDisplayName: vi.fn(),
    getUserByEmailAddress: vi.fn(),
    getUserByPhoneNumber: vi.fn(),
    getUserByMembershipId: vi.fn(),
    updateAnonymousUser: vi.fn().mockImplementation(user => Promise.resolve(user)),
    updateUser: vi.fn().mockImplementation(user => Promise.resolve(user)),
};
const worldRepository = {
    getVendorIcon: vi.fn().mockResolvedValue('some-vendor-icon'),
};

let userController;

beforeEach(() => {
    userController = new UserController({ destinyService, notificationService, userService, worldRepository });
});

describe('UserController', () => {
    describe('deleteMessages', () => {
        describe('when user is given', () => {
            it('should call deleteUserMessages when the user has a phone number', async () => {
                await userController.deleteUserMessages({ phoneNumber });

                expect(userService.deleteUserMessages).toHaveBeenCalled();
            });

            it('should throw if the user is missing', async () => {
                await expect(userController.deleteUserMessages())
                    .rejects.toThrow();
            });

            it('should throw if the user is missing a phone number', async () => {
                await expect(userController.deleteUserMessages({}))
                    .rejects.toThrow();
            });
        });
    });

    describe('getCurrentUser', () => {
        describe('when session displayName and membershipType are defined', () => {
            describe('when user and destiny services return a user', () => {
                it('should return the current user', async () => {
                    const ETag = chance.guid();

                    destinyService.getCurrentUser.mockImplementation(() => Promise.resolve({
                        displayName: 'l',
                        membershipType: 2,
                        links: [
                            {
                                rel: 'characters',
                                href: '/destiny/characters',
                            },
                        ],
                    }));
                    userService.getUserByDisplayName.mockImplementation(() => Promise.resolve({
                        _etag: ETag,
                        bungie: {
                            accessToken: {
                                value: '11',
                            },
                        },
                        notifications: [
                            {
                                enabled: true,
                                type: 'Xur',
                            }
                        ],
                    }));

                    const currentUser = await userController.getCurrentUser(displayName, membershipType);

                    expect(currentUser.ETag).toEqual(ETag);
                    expect(currentUser.user).not.toBeUndefined();
                    expect(currentUser.user?.notifications.length).toBeGreaterThan(0);
                });
            });

            describe('when destiny service returns undefined', () => {
                it('should not return a user', async () => {
                    destinyService.getCurrentUser.mockImplementation(() => Promise.resolve());
                    userService.getUserByDisplayName.mockImplementation(() => Promise.resolve({
                        bungie: {
                            accessToken: {
                                value: '11',
                            },
                        },
                    }));

                    const { user } = await userController.getCurrentUser(displayName, membershipType);

                    expect(user).toBeUndefined();
                });
            });

            describe('when user service returns undefined', () => {
                it('should not return a user', async () => {
                    destinyService.getCurrentUser.mockImplementation(() => Promise.resolve({
                        displayName: 'l',
                        membershipType: 2,
                        links: [
                            {
                                rel: 'characters',
                                href: '/destiny/characters',
                            },
                        ],
                    }));
                    userService.getUserByDisplayName.mockImplementation(() => Promise.resolve());

                    const { user } = await userController.getCurrentUser(displayName, membershipType);

                    expect(user).toBeUndefined();
                });
            });
        });
    });

    describe('signIn', () => {
        beforeEach(() => {
            destinyService.getAccessTokenFromCode.mockImplementation(() => Promise.resolve({
                access_token: 'some-access-token',
            }));
        });

        describe('when current user is not found', () => {
            it('should return undefined', async () => {
                const currentUser = await userController.signIn({});

                expect(currentUser).toBeUndefined();
            });
        });

        describe('when current user is found', () => {
            beforeEach(() => {
                destinyService.getCurrentUser
                    .mockImplementation(() => Promise.resolve(mockUser));
            });
            describe('when current user is a first time visitor', () => {
                it('should create anonymous user', async () => {
                    const currentUser = await userController.signIn({});

                    expect(currentUser).toEqual({
                        bungie: {
                            access_token: 'some-access-token',
                        },
                        ...mockUser,
                    });
                    expect(userService.createAnonymousUser).toHaveBeenCalled();
                });
            });

            describe('when current user is a repeat visitor', () => {
                describe('when current user is anonymous', () => {
                    it('should update the anonymous user', async () => {
                        userService.getUserByMembershipId
                            .mockImplementation(() => Promise.resolve(mockUser));

                        const currentUser = await userController.signIn({});

                        expect(currentUser).toEqual({
                            bungie: {
                                access_token: 'some-access-token',
                            },
                            ...mockUser,
                        });
                        expect(userService.updateAnonymousUser).toHaveBeenCalled();
                    });
                });

                describe('when current user is registered', () => {
                    it('should update the registered user', async () => {
                        userService.getUserByMembershipId
                            .mockImplementation(() => Promise.resolve({
                                dateRegistered: new Date().toISOString(),
                                ...mockUser,
                            }));

                        const currentUser = await userController.signIn({});

                        expect(currentUser).toEqual({
                            bungie: {
                                access_token: 'some-access-token',
                            },
                            ...mockUser,
                        });
                        expect(userService.updateUser).toHaveBeenCalled();
                    });
                });
            });
        });
    });

    describe('signUp', () => {
        describe('when user is not registered', () => {
            describe('when phone number is valid', () => {
                it('should update user', async () => {
                    userService.getUserByDisplayName.mockImplementation(() => Promise.resolve());
                    userService.getUserByEmailAddress.mockImplementation(() => Promise.resolve());
                    userService.getUserByPhoneNumber.mockImplementation(() => Promise.resolve());

                    const user = await userController.signUp({
                        displayName,
                        membershipType,
                        user: {
                            phoneNumber,
                        },
                    });

                    expect(userService.updateUser).toHaveBeenCalled();
                    expect(user).not.toBeUndefined();
                });
            });
            describe('when phone number is invalid', () => {
                it('should not update user', async () => {
                    userService.getUserByDisplayName.mockImplementation(() => Promise.resolve());
                    userService.getUserByEmailAddress.mockImplementation(() => Promise.resolve());
                    userService.getUserByPhoneNumber.mockImplementation(() => Promise.resolve());

                    await expect(userController.signUp({
                        displayName,
                        membershipType,
                        user: {
                            phoneNumber: '+86 10 1234 5678',
                        },
                    })).rejects.toThrow(Error);
                });
            });
        });

        describe('when user is registered', () => {
            it('should not return a user', async () => {
                userService.getUserByDisplayName.mockImplementation(() => Promise.resolve({
                    displayName,
                    membershipType,
                }));
                userService.getUserByEmailAddress.mockImplementation(() => Promise.resolve({
                    dateRegistered: new Date().toISOString(),
                }));

                const user = await userController.signUp({
                    displayName,
                    membershipType,
                    user: { phoneNumber, ...mockUser },
                });

                expect(user).toBeUndefined();
            });
        });
    });

    describe('update', () => {
        describe('when user is undefined', () => {
            it('should not return a user', async () => {
                userService.getUserByDisplayName.mockImplementation(() => Promise.resolve());

                const user = await userController.update({
                    displayName,
                    membershipType,
                    patches: [],
                });

                expect(user).toBeUndefined();
            });
        });

        describe('when user is defined', () => {
            it('should patch the user', async () => {
                const firstName = '11';
                const patches = [
                    {
                        op: 'replace',
                        path: '/firstName',
                        value: firstName,
                    },
                ];
                const user = {
                    displayName,
                    firstName: '08',
                    membershipType,
                };
                const mock = userService.updateUser;

                userService.getUserByDisplayName.mockImplementation(() => Promise.resolve(user));

                const patchedUser = await userController.update({
                    displayName,
                    membershipType,
                    patches,
                });

                expect(patchedUser).not.toBeUndefined();
                expect(mock).toHaveBeenCalledWith({
                    displayName,
                    firstName,
                    membershipType,
                    version: 2,
                    patches: [
                        {
                            patch: [
                                {
                                    op: 'replace',
                                    path: '/firstName',
                                    value: '08',
                                },
                            ],
                            version: 1,
                        },
                    ],
                });
            });
        });
    });
});
