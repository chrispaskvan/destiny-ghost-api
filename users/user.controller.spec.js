import {
    beforeEach, describe, expect, it, vi,
} from 'vitest';
import Chance from 'chance';
import UserController from './user.controller';

const chance = new Chance();
const displayName = chance.name();
const membershipId = chance.integer().toString();
const membershipType = chance.integer({ min: 1, max: 2 });
const phoneNumber = chance.phone();
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
const userService = {
    createAnonymousUser: vi.fn().mockImplementation(user => Promise.resolve(user)),
    deleteUserMessages: vi.fn().mockResolvedValue(),
    getCurrentUser: vi.fn(),
    getUserByDisplayName: vi.fn(),
    getUserByMembershipId: vi.fn(),
    updateAnonymousUser: vi.fn().mockImplementation(user => Promise.resolve(user)),
    updateUser: vi.fn().mockImplementation(user => Promise.resolve(user)),
};

let userController;

beforeEach(() => {
    userController = new UserController({ destinyService, userService });
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
                        bungie: {
                            accessToken: {
                                value: '11',
                            },
                        },
                    }));

                    const user = await userController.getCurrentUser(displayName, membershipType);

                    expect(user).not.toBeUndefined();
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

                    const user = await userController.getCurrentUser(displayName, membershipType);

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

                    const user = await userController.getCurrentUser(displayName, membershipType);

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
