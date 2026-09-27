import { beforeEach, describe, expect, it, vi } from 'vitest';
import Chance from 'chance';
import getEpoch from '../helpers/get-epoch.js';
import { get, post } from '../helpers/bungie.request.js';
import DestinyService from '../destiny/destiny.service.js';
import UserController from './user.controller.js';
import UserService from './user.service.js';
import InvalidPhoneNumberError from './invalid-phone-number.error.js';

vi.mock('../helpers/bungie.request.js');
vi.mock('../helpers/postmaster.js', () => ({
    default: class {
        register = vi.fn();
    },
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
    getUserByEmailAddressToken: vi.fn(),
    getUserById: vi.fn(),
    getUserByBungieMembershipId: vi.fn(),
    getUserByMembershipId: vi.fn(),
    getUserByPhoneNumber: vi.fn(),
    movePlatform: vi.fn().mockImplementation(user => Promise.resolve(user)),
    updateAnonymousUser: vi.fn().mockImplementation(user => Promise.resolve(user)),
    updateUser: vi.fn().mockImplementation(user => Promise.resolve(user)),
};
const worldRepository = {
    getVendorIcon: vi.fn().mockResolvedValue('some-vendor-icon'),
};

let userController;

beforeEach(() => {
    userController = new UserController({
        destinyService,
        notificationService,
        userService,
        worldRepository,
    });
});

describe('UserController', () => {
    describe('deleteMessages', () => {
        describe('when user is given', () => {
            it('should call deleteUserMessages when the user has a phone number', async () => {
                await userController.deleteUserMessages({ phoneNumber });

                expect(userService.deleteUserMessages).toHaveBeenCalled();
            });

            it('should throw if the user is missing', async () => {
                await expect(userController.deleteUserMessages()).rejects.toThrow();
            });

            it('should throw if the user is missing a phone number', async () => {
                await expect(userController.deleteUserMessages({})).rejects.toThrow();
            });
        });
    });

    describe('getCurrentUser', () => {
        describe('when session displayName and membershipType are defined', () => {
            describe('when user and destiny services return a user', () => {
                it('should return the current user', async () => {
                    const ETag = chance.guid();

                    destinyService.getCurrentUser.mockImplementation(() =>
                        Promise.resolve({
                            displayName: 'l',
                            membershipType: 2,
                            links: [
                                {
                                    rel: 'characters',
                                    href: '/destiny/characters',
                                },
                            ],
                        }),
                    );
                    userService.getUserByDisplayName.mockImplementation(() =>
                        Promise.resolve({
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
                                },
                            ],
                        }),
                    );

                    const currentUser = await userController.getCurrentUser(
                        displayName,
                        membershipType,
                    );

                    expect(currentUser.ETag).toEqual(ETag);
                    expect(currentUser.user).not.toBeUndefined();
                    expect(currentUser.user?.notifications.length).toBeGreaterThan(0);
                });
            });

            describe('when destiny service returns undefined', () => {
                it('should not return a user', async () => {
                    destinyService.getCurrentUser.mockImplementation(() => Promise.resolve());
                    userService.getUserByDisplayName.mockImplementation(() =>
                        Promise.resolve({
                            bungie: {
                                accessToken: {
                                    value: '11',
                                },
                            },
                        }),
                    );

                    const { user } = await userController.getCurrentUser(
                        displayName,
                        membershipType,
                    );

                    expect(user).toBeUndefined();
                });
            });

            describe('when user service returns undefined', () => {
                it('should not return a user', async () => {
                    destinyService.getCurrentUser.mockImplementation(() =>
                        Promise.resolve({
                            displayName: 'l',
                            membershipType: 2,
                            links: [
                                {
                                    rel: 'characters',
                                    href: '/destiny/characters',
                                },
                            ],
                        }),
                    );
                    userService.getUserByDisplayName.mockImplementation(() => Promise.resolve());

                    const { user } = await userController.getCurrentUser(
                        displayName,
                        membershipType,
                    );

                    expect(user).toBeUndefined();
                });
            });
        });
    });

    describe('getUserById', () => {
        describe('when user is found', () => {
            describe('when no version is given', () => {
                it('should return the user', async () => {
                    userService.getUserById.mockImplementation(() => Promise.resolve(mockUser));

                    const user = await userController.getUserById(chance.guid(), 'a');

                    expect(user).toEqual(mockUser);
                });
            });

            describe('when version number provided is less than the current version', () => {
                it('should return the user', async () => {
                    const version = 1;

                    userService.getUserById.mockImplementation(() =>
                        Promise.resolve({
                            ...mockUser,
                            firstName: 'Failsafe v3.0',
                            version: 3,
                            patches: [
                                {
                                    patch: [
                                        {
                                            op: 'replace',
                                            path: '/firstName',
                                            value: 'Failsafe v2.0',
                                        },
                                    ],
                                    version: 2,
                                },
                                {
                                    patch: [
                                        {
                                            op: 'replace',
                                            path: '/firstName',
                                            value: 'Failsafe',
                                        },
                                    ],
                                    version: 1,
                                },
                            ],
                        }),
                    );

                    const user = await userController.getUserById(chance.guid(), version);

                    expect(user).toEqual({
                        ...mockUser,
                        firstName: 'Failsafe',
                        version,
                    });
                });
            });
        });

        describe('when user is not found', () => {
            it('should return undefined', async () => {
                userService.getUserById.mockImplementation(() => Promise.resolve());

                const user = await userController.getUserById(chance.guid(), -1);

                expect(user).toBeUndefined();
            });
        });
    });

    describe('join', () => {
        describe('when the request is missing an email address token', () => {
            it('should return undefined without querying the user service', async () => {
                const user = await userController.join({ tokens: {} });

                expect(userService.getUserByEmailAddressToken).not.toHaveBeenCalled();
                expect(user).toBeUndefined();
            });
        });
        describe('when user is not found', () => {
            it('should return undefined', async () => {
                userService.getUserByEmailAddressToken.mockImplementation(() => Promise.resolve());

                const user = await userController.join({
                    tokens: {
                        emailAddress: 'some-token',
                    },
                });

                expect(userService.getUserByEmailAddressToken).toHaveBeenCalled();
                expect(user).toBeUndefined();
                expect(userService.updateUser).not.toHaveBeenCalled();
            });
        });
        describe('when user is found', () => {
            const code = chance.string();

            describe('when the token has expired', () => {
                it('should return undefined', async () => {
                    userService.getUserByEmailAddressToken.mockImplementation(() =>
                        Promise.resolve({
                            membership: {
                                tokens: {
                                    timeStamp: getEpoch() - 1000,
                                    code,
                                },
                            },
                        }),
                    );

                    const user = await userController.join({
                        tokens: {
                            emailAddress: 'some-token',
                            phoneNumber: code,
                        },
                    });

                    expect(userService.getUserByEmailAddressToken).toHaveBeenCalled();
                    expect(user).toBeUndefined();
                    expect(userService.updateUser).not.toHaveBeenCalled();
                });
            });

            describe('when the code is invalid', () => {
                it('should return undefined', async () => {
                    userService.getUserByEmailAddressToken.mockImplementation(() =>
                        Promise.resolve({
                            membership: {
                                tokens: {
                                    timeStamp: getEpoch(),
                                    code,
                                },
                            },
                        }),
                    );

                    const user = await userController.join({
                        tokens: {
                            emailAddress: 'some-token',
                            phoneNumber: 'wrong-code',
                        },
                    });

                    expect(userService.getUserByEmailAddressToken).toHaveBeenCalled();
                    expect(user).toBeUndefined();
                    expect(userService.updateUser).not.toHaveBeenCalled();
                });
            });

            describe('when the code and token are valid', () => {
                it('should return the registered user, not the request body', async () => {
                    userService.getUserByEmailAddressToken.mockImplementation(() =>
                        Promise.resolve({
                            membership: {
                                tokens: {
                                    timeStamp: getEpoch(),
                                    code,
                                },
                            },
                            phoneNumber: `+1${phoneNumber}`,
                            ...mockUser,
                        }),
                    );

                    const user = await userController.join({
                        tokens: {
                            emailAddress: 'some-token',
                            phoneNumber: code,
                        },
                    });

                    expect(userService.getUserByEmailAddressToken).toHaveBeenCalled();
                    expect(user).toMatchObject(mockUser);
                    expect(user.dateRegistered).toBeDefined();
                    expect(userService.updateUser).toHaveBeenCalled();
                    expect(notificationService.sendMessage).toHaveBeenCalledWith(
                        'Welcome! Message frequency varies. Msg & data rates may apply. Reply HELP for help, STOP to cancel.',
                        `+1${phoneNumber}`,
                        '',
                    );
                });

                it('should still join if sending the welcome message fails', async () => {
                    notificationService.sendMessage.mockRejectedValueOnce(
                        new Error('twilio error'),
                    );
                    userService.getUserByEmailAddressToken.mockImplementation(() =>
                        Promise.resolve({
                            membership: {
                                tokens: {
                                    timeStamp: getEpoch(),
                                    code,
                                },
                            },
                            phoneNumber: `+1${phoneNumber}`,
                            ...mockUser,
                        }),
                    );

                    const user = await userController.join({
                        tokens: {
                            emailAddress: 'some-token',
                            phoneNumber: code,
                        },
                    });

                    expect(userService.getUserByEmailAddressToken).toHaveBeenCalled();
                    expect(user).toMatchObject(mockUser);
                    expect(user.dateRegistered).toBeDefined();
                    expect(userService.updateUser).toHaveBeenCalled();
                });

                it('should not resend welcome message or update dateRegistered for already-registered users', async () => {
                    const existingDateRegistered = Temporal.Now.instant().toString();

                    notificationService.sendMessage.mockClear();
                    userService.getUserByEmailAddressToken.mockImplementation(() =>
                        Promise.resolve({
                            dateRegistered: existingDateRegistered,
                            membership: {
                                tokens: {
                                    timeStamp: getEpoch(),
                                    code,
                                },
                            },
                            phoneNumber: `+1${phoneNumber}`,
                            ...mockUser,
                        }),
                    );

                    const user = await userController.join({
                        tokens: {
                            emailAddress: 'some-token',
                            phoneNumber: code,
                        },
                    });

                    expect(user.dateRegistered).toBe(existingDateRegistered);
                    expect(notificationService.sendMessage).not.toHaveBeenCalled();
                });

                it('should seed all known notification types', async () => {
                    userService.getUserByEmailAddressToken.mockImplementation(() =>
                        Promise.resolve({
                            membership: {
                                tokens: {
                                    timeStamp: getEpoch(),
                                    code,
                                },
                            },
                            phoneNumber: `+1${phoneNumber}`,
                            ...mockUser,
                        }),
                    );

                    await userController.join({
                        tokens: {
                            emailAddress: 'some-token',
                            phoneNumber: code,
                        },
                    });

                    const [savedUser] = userService.updateUser.mock.calls.at(-1);

                    expect(savedUser.notifications).toEqual([
                        { enabled: false, type: 'Orders', messages: [] },
                        { enabled: false, type: 'Banshee-44', messages: [] },
                        { enabled: false, type: 'Lord Saladin', messages: [] },
                        { enabled: false, type: 'Xur', messages: [] },
                    ]);
                });

                it('should not overwrite existing notifications', async () => {
                    const existingNotifications = [{ enabled: true, type: 'Xur', messages: [] }];

                    userService.getUserByEmailAddressToken.mockImplementation(() =>
                        Promise.resolve({
                            membership: {
                                tokens: {
                                    timeStamp: getEpoch(),
                                    code,
                                },
                            },
                            notifications: existingNotifications,
                            phoneNumber: `+1${phoneNumber}`,
                            ...mockUser,
                        }),
                    );

                    await userController.join({
                        tokens: {
                            emailAddress: 'some-token',
                            phoneNumber: code,
                        },
                    });

                    const [savedUser] = userService.updateUser.mock.calls.at(-1);

                    expect(savedUser.notifications).toEqual(existingNotifications);
                });
            });
        });
    });

    describe('signIn', () => {
        /**
         * `membership_id` is the Bungie.net id, the one identifier that
         * survives a cross-save owner change. Shared between the mock and the
         * assertions so the fixture cannot drift from what is asserted.
         */
        const bungieToken = {
            access_token: 'some-access-token',
            membership_id: 'bungie-net-99',
        };

        beforeEach(() => {
            destinyService.getAccessTokenFromCode.mockResolvedValue(bungieToken);
        });

        describe('when current user is not found', () => {
            it('should return undefined', async () => {
                const currentUser = await userController.signIn({});

                expect(currentUser).toBeUndefined();
            });
        });

        describe('when current user is found', () => {
            beforeEach(() => {
                destinyService.getCurrentUser.mockImplementation(() => Promise.resolve(mockUser));
            });
            describe('when current user is a first time visitor', () => {
                it('should create anonymous user', async () => {
                    const currentUser = await userController.signIn({});

                    expect(currentUser).toEqual({
                        bungie: bungieToken,
                        ...mockUser,
                    });
                    expect(userService.createAnonymousUser).toHaveBeenCalled();
                });
            });

            describe('when current user is a repeat visitor', () => {
                describe('when current user is anonymous', () => {
                    it('should update the anonymous user', async () => {
                        userService.getUserByMembershipId.mockImplementation(() =>
                            Promise.resolve(mockUser),
                        );

                        const currentUser = await userController.signIn({});

                        expect(currentUser).toEqual({
                            bungie: bungieToken,
                            ...mockUser,
                        });
                        expect(userService.updateAnonymousUser).toHaveBeenCalled();
                    });
                });

                describe('when the cross-save owner has changed', () => {
                    /**
                     * Bungie reports the owning membership, so moving cross save
                     * to another platform changes both the membership id and the
                     * platform. Nothing the old record is keyed on still matches.
                     */
                    const steamUser = {
                        displayName: 'SteamPersona',
                        membershipId: 'steam-membership',
                        membershipType: 3,
                        profilePicturePath: 'some-profile-picture-path',
                    };
                    const storedXboxUser = {
                        dateRegistered: Temporal.Now.instant().toString(),
                        displayName: 'XboxGamertag',
                        id: 'user-1',
                        membershipId: 'xbox-membership',
                        membershipType: 1,
                    };

                    beforeEach(() => {
                        destinyService.getCurrentUser.mockResolvedValue(steamUser);
                        userService.getUserByMembershipId.mockResolvedValue(undefined);
                        userService.getUserByBungieMembershipId.mockResolvedValue(storedXboxUser);
                    });

                    it('should find the record by its Bungie membership id', async () => {
                        await userController.signIn({});

                        expect(userService.getUserByBungieMembershipId).toHaveBeenCalledWith(
                            'bungie-net-99',
                        );
                    });

                    it('should move the record rather than update it in place', async () => {
                        await userController.signIn({});

                        expect(userService.movePlatform).toHaveBeenCalledWith(
                            storedXboxUser,
                            expect.objectContaining({ membershipType: 3 }),
                        );
                        expect(userService.updateUser).not.toHaveBeenCalled();
                        expect(userService.createAnonymousUser).not.toHaveBeenCalled();
                    });

                    it('should return the signed-in user', async () => {
                        await expect(userController.signIn({})).resolves.toMatchObject({
                            displayName: 'SteamPersona',
                            membershipType: 3,
                        });
                    });
                });

                describe('when the platform is unchanged', () => {
                    it('should update in place without moving partitions', async () => {
                        userService.getUserByMembershipId.mockResolvedValue({
                            dateRegistered: Temporal.Now.instant().toString(),
                            ...mockUser,
                        });

                        await userController.signIn({});

                        expect(userService.movePlatform).not.toHaveBeenCalled();
                        expect(userService.updateUser).toHaveBeenCalled();
                    });
                });

                describe('when current user is registered', () => {
                    it('should update the registered user', async () => {
                        userService.getUserByMembershipId.mockImplementation(() =>
                            Promise.resolve({
                                dateRegistered: Temporal.Now.instant().toString(),
                                ...mockUser,
                            }),
                        );

                        const currentUser = await userController.signIn({});

                        expect(currentUser).toEqual({
                            bungie: bungieToken,
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
                        contact: {
                            firstName: 'Ada',
                            lastName: 'Lovelace',
                            emailAddress: 'ada@example.com',
                            phoneNumber,
                        },
                    });

                    expect(userService.updateUser).toHaveBeenCalled();
                    expect(user).not.toBeUndefined();
                    expect(notificationService.sendMessage).toHaveBeenCalledWith(
                        expect.stringContaining('Reply HELP for help, STOP to cancel.'),
                        `+1${phoneNumber}`,
                        '',
                    );

                    const [persisted] = userService.updateUser.mock.calls[0];

                    /**
                     * Registration state belongs to `join`, which runs only
                     * once the emailed blob and the SMS code check out. Sign-up
                     * assembles the document itself, so neither field can
                     * arrive on it.
                     */
                    expect(persisted.dateRegistered).toBeUndefined();
                    expect(persisted.notifications).toBeUndefined();
                    expect(persisted.isSubscribed).toBeUndefined();
                    expect(persisted.roles).toBeUndefined();
                    expect(persisted.phoneNumber).toBe(`+1${phoneNumber}`);
                    expect(persisted.membership.tokens).toEqual(
                        expect.objectContaining({
                            blob: expect.any(String),
                            code: expect.any(String),
                        }),
                    );
                });

                it('should ignore server-owned fields a caller slips past the route', async () => {
                    userService.getUserByDisplayName.mockImplementation(() => Promise.resolve());
                    userService.getUserByEmailAddress.mockImplementation(() => Promise.resolve());
                    userService.getUserByPhoneNumber.mockImplementation(() => Promise.resolve());

                    /**
                     * The route rejects these outright; this pins the second
                     * line of defence, so a future caller reaching the
                     * controller directly cannot reintroduce the hole.
                     */
                    await userController.signUp({
                        displayName,
                        membershipType,
                        contact: {
                            firstName: 'Ada',
                            lastName: 'Lovelace',
                            emailAddress: 'ada@example.com',
                            phoneNumber,
                            dateRegistered: '2020-01-01T00:00:00.000Z',
                            notifications: [{ enabled: true, type: 'Xur', messages: [] }],
                            roles: ['Admin'],
                        },
                    });

                    const [persisted] = userService.updateUser.mock.calls[0];

                    expect(persisted.dateRegistered).toBeUndefined();
                    expect(persisted.notifications).toBeUndefined();
                    expect(persisted.roles).toBeUndefined();
                });
            });
            describe('when phone number is invalid', () => {
                it('should not update user', async () => {
                    userService.getUserByDisplayName.mockImplementation(() => Promise.resolve());
                    userService.getUserByEmailAddress.mockImplementation(() => Promise.resolve());
                    userService.getUserByPhoneNumber.mockImplementation(() => Promise.resolve());

                    /**
                     * The route decides the status code from the type, so a
                     * bare `Error` here would send an unusable number back as
                     * a 500.
                     */
                    await expect(
                        userController.signUp({
                            displayName,
                            membershipType,
                            contact: {
                                firstName: 'Ada',
                                lastName: 'Lovelace',
                                emailAddress: 'ada@example.com',
                                phoneNumber: '+86 10 1234 5678',
                            },
                        }),
                    ).rejects.toBeInstanceOf(InvalidPhoneNumberError);
                });
            });
        });

        describe('when user is registered', () => {
            it('should not return a user', async () => {
                userService.getUserByDisplayName.mockImplementation(() =>
                    Promise.resolve({
                        displayName,
                        membershipType,
                    }),
                );
                userService.getUserByEmailAddress.mockImplementation(() =>
                    Promise.resolve({
                        dateRegistered: Temporal.Now.instant().toString(),
                    }),
                );

                const user = await userController.signUp({
                    displayName,
                    membershipType,
                    contact: {
                        firstName: 'Ada',
                        lastName: 'Lovelace',
                        emailAddress: 'ada@example.com',
                        phoneNumber,
                    },
                });

                expect(user).toBeUndefined();
            });
        });
    });

    describe('sendCipher', () => {
        describe('when channel is phone', () => {
            it('should send a compliant verification message', async () => {
                userService.getUserByDisplayName.mockImplementation(() =>
                    Promise.resolve({
                        displayName,
                        emailAddress: 'some-email-address',
                        dateRegistered: Temporal.Now.instant().toString(),
                        membershipType,
                        phoneNumber: `+1${phoneNumber}`,
                    }),
                );

                await userController.sendCipher({ displayName, membershipType, channel: 'phone' });

                expect(notificationService.sendMessage).toHaveBeenCalledWith(
                    expect.stringContaining('Reply HELP for help, STOP to cancel.'),
                    `+1${phoneNumber}`,
                    '',
                );
                expect(userService.updateUser).toHaveBeenCalled();
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

            it("should patch a notification's enabled flag", async () => {
                const patches = [
                    {
                        op: 'replace',
                        path: '/notifications/0/enabled',
                        value: true,
                    },
                ];
                const user = {
                    displayName,
                    membershipType,
                    notifications: [{ enabled: false, type: 'Xur', messages: [] }],
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
                    membershipType,
                    notifications: [{ enabled: true, type: 'Xur', messages: [] }],
                    version: 2,
                    patches: [
                        {
                            patch: [
                                {
                                    op: 'replace',
                                    path: '/notifications/0/enabled',
                                    value: false,
                                },
                            ],
                            version: 1,
                        },
                    ],
                });
            });

            it('should strip a notification enabled patch with a non-boolean value', async () => {
                const patches = [
                    {
                        op: 'replace',
                        path: '/notifications/0/enabled',
                        value: 'true',
                    },
                ];
                const user = {
                    displayName,
                    membershipType,
                    notifications: [{ enabled: false, type: 'Xur', messages: [] }],
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
                    membershipType,
                    notifications: [{ enabled: false, type: 'Xur', messages: [] }],
                    version: 2,
                    patches: [
                        {
                            patch: [],
                            version: 1,
                        },
                    ],
                });
            });

            it('should strip patches to non-mutable fields', async () => {
                const patches = [
                    { op: 'replace', path: '/emailAddress', value: 'new@example.com' },
                    { op: 'replace', path: '/notifications/0/type', value: 'Xur' },
                ];
                const user = {
                    displayName,
                    emailAddress: 'old@example.com',
                    membershipType,
                    notifications: [{ enabled: false, type: 'Orders', messages: [] }],
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
                    emailAddress: 'old@example.com',
                    membershipType,
                    notifications: [{ enabled: false, type: 'Orders', messages: [] }],
                    version: 2,
                    patches: [
                        {
                            patch: [],
                            version: 1,
                        },
                    ],
                });
            });

            it('should reject a patch that targets a notification index that does not exist', async () => {
                const patches = [
                    {
                        op: 'replace',
                        path: '/notifications/5/enabled',
                        value: true,
                    },
                ];
                const user = {
                    displayName,
                    membershipType,
                    notifications: [{ enabled: false, type: 'Xur', messages: [] }],
                };

                userService.getUserByDisplayName.mockImplementation(() => Promise.resolve(user));
                userService.updateUser.mockClear();

                await expect(
                    userController.update({
                        displayName,
                        membershipType,
                        patches,
                    }),
                ).rejects.toThrow('invalid patch');

                expect(userService.updateUser).not.toHaveBeenCalled();
            });
        });
    });
});

/**
 * Issue #718 lived in the seam rather than in either module: the membership
 * `DestinyService` picks is the one `UserService` validates, and the two
 * disagreed about which platforms exist. Both are real here, with only Bungie
 * and Cosmos replaced, so a fixture has to survive the whole first sign-in.
 */
describe('UserController.signIn against the real Destiny and User services', () => {
    const cacheService = { deleteUser: vi.fn(), getUser: vi.fn(), setUser: vi.fn() };
    const documentService = {
        createDocument: vi.fn(),
        deleteDocumentById: vi.fn(),
        getDocuments: vi.fn(() => []),
    };

    let controller;

    beforeEach(() => {
        vi.clearAllMocks();

        controller = new UserController({
            destinyService: new DestinyService({ cacheService: {} }),
            notificationService,
            userService: new UserService({ cacheService, client: {}, documentService }),
            worldRepository,
        });
    });

    describe.each([
        ['Xbox', 1],
        ['PlayStation Network', 2],
        ['Steam', 3],
        ['Epic Games Store', 6],
    ])('when a first time visitor signs in on %s', (_platform, platformMembershipType) => {
        it('should persist the anonymous user', async () => {
            const bungieDisplayName = chance.string({ length: 12, alpha: true });

            post.mockResolvedValue({
                access_token: 'some-access-token',
                expires_in: 3600,
                membership_id: '99',
                refresh_token: 'some-refresh-token',
            });
            get.mockResolvedValueOnce({
                ErrorCode: 1,
                Response: {
                    bungieNetUser: { profilePicturePath: '/img/profile/avatars/Destiny26.jpg' },
                    destinyMemberships: [
                        {
                            crossSaveOverride: 0,
                            displayName: bungieDisplayName,
                            membershipId: '4611686018400000000',
                            membershipType: platformMembershipType,
                        },
                    ],
                },
            });

            await expect(controller.signIn({ code: 'some-code' })).resolves.toMatchObject({
                displayName: bungieDisplayName,
                membershipType: platformMembershipType,
            });

            expect(documentService.createDocument).toHaveBeenCalledWith(
                'Users',
                expect.objectContaining({
                    displayName: bungieDisplayName,
                    membershipType: platformMembershipType,
                }),
            );
        });
    });

    describe('when a registered player moves their cross-save owner to Steam', () => {
        /**
         * The lookup by platform membership id misses, because that id changed
         * with the owner. Only `bungie.membership_id` still matches - and the
         * record cannot simply be updated, because `membershipType` is the
         * Cosmos partition key.
         */
        const storedXboxUser = {
            _etag: 'stored-etag',
            bungie: { access_token: 'old-token', membership_id: 'bungie-net-99' },
            dateRegistered: '2026-01-01T00:00:00Z',
            displayName: 'XboxGamertag',
            emailAddress: 'player@destiny-ghost.com',
            id: 'user-1',
            membershipId: 'xbox-membership',
            membershipType: 1,
            phoneNumber: '+12085551234',
        };

        beforeEach(() => {
            post.mockResolvedValue({
                access_token: 'some-access-token',
                expires_in: 3600,
                membership_id: 'bungie-net-99',
                refresh_token: 'some-refresh-token',
            });
            get.mockResolvedValueOnce({
                ErrorCode: 1,
                Response: {
                    destinyMemberships: [
                        {
                            crossSaveOverride: 3,
                            displayName: 'XboxGamertag',
                            membershipId: 'xbox-membership',
                            membershipType: 1,
                        },
                        {
                            crossSaveOverride: 3,
                            displayName: 'SteamPersona',
                            membershipId: 'steam-membership',
                            membershipType: 3,
                        },
                    ],
                },
            });
            documentService.getDocuments.mockImplementation((_collection, query) =>
                Promise.resolve(
                    query.query.includes('bungie.membership_id') ? [storedXboxUser] : [],
                ),
            );
            documentService.createDocument.mockImplementation((_collection, document) =>
                Promise.resolve(document),
            );
        });

        it('should keep the registration instead of stranding it on the old partition', async () => {
            await expect(controller.signIn({ code: 'some-code' })).resolves.toMatchObject({
                displayName: 'SteamPersona',
                membershipType: 3,
            });

            expect(documentService.createDocument).toHaveBeenCalledWith(
                'Users',
                expect.objectContaining({
                    displayName: 'SteamPersona',
                    membershipId: 'steam-membership',
                    membershipType: 3,
                    dateRegistered: '2026-01-01T00:00:00Z',
                    phoneNumber: '+12085551234',
                    emailAddress: 'player@destiny-ghost.com',
                }),
            );
            expect(documentService.deleteDocumentById).toHaveBeenCalledWith('Users', 'user-1', 1);
        });

        it('should not sign them in as a brand new anonymous user', async () => {
            await controller.signIn({ code: 'some-code' });

            const [, document] = documentService.createDocument.mock.calls[0];

            expect(document.dateRegistered).toBeDefined();
            expect(documentService.createDocument).toHaveBeenCalledTimes(1);
        });
    });

    describe('when the account has no playable membership', () => {
        it('should sign nobody in and store nothing', async () => {
            post.mockResolvedValue({
                access_token: 'some-access-token',
                expires_in: 3600,
                membership_id: '99',
                refresh_token: 'some-refresh-token',
            });
            get.mockResolvedValueOnce({
                ErrorCode: 1,
                Response: { destinyMemberships: [] },
            });

            await expect(controller.signIn({ code: 'some-code' })).resolves.toBeUndefined();

            expect(documentService.createDocument).not.toHaveBeenCalled();
        });
    });
});
