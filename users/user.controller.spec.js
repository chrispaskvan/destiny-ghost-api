import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Chance from 'chance';
import getEpoch from '../helpers/get-epoch.js';
import { get, post } from '../helpers/bungie.request.js';
import DestinyService from '../destiny/destiny.service.js';
import UserController from './user.controller.js';
import UserService from './user.service.js';
import CipherAttemptsExceededError from './cipher-attempts-exceeded.error.js';
import InvalidCipherError from './invalid-cipher.error.js';
import InvalidPhoneNumberError from './invalid-phone-number.error.js';

const { logError, logInfo, logWarn } = vi.hoisted(() => ({
    logError: vi.fn(),
    logInfo: vi.fn(),
    logWarn: vi.fn(),
}));

vi.mock('../helpers/bungie.request.js');
vi.mock('../helpers/log.js', () => ({
    default: { error: logError, info: logInfo, warn: logWarn },
}));
vi.mock('../helpers/postmaster.js', () => ({
    default: class {
        confirm = vi.fn();
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
const allowCipherAttempt = vi.fn().mockResolvedValue(true);
const readConsent = vi.fn().mockResolvedValue(undefined);
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
    clearPlatformMove: vi.fn().mockResolvedValue(),
    movePlatform: vi.fn().mockImplementation(user => Promise.resolve(user)),
    updateAnonymousUser: vi.fn().mockImplementation(user => Promise.resolve(user)),
    updateUser: vi.fn().mockImplementation(user => Promise.resolve(user)),
    updateUserSubscription: vi.fn().mockResolvedValue(),
};
const worldRepository = {
    getVendorIcon: vi.fn().mockResolvedValue('some-vendor-icon'),
};

let userController;

beforeEach(() => {
    userController = new UserController({
        allowCipherAttempt,
        readConsent,
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

    describe('verification token TTL', () => {
        const code = '123456';
        /**
         * `getEpoch` has one-second resolution and keeps running between
         * minting the timestamp here and checking it in the controller, so
         * each case stays a few seconds clear of the boundary.
         */
        const tokensAged = seconds => ({ code, timeStamp: getEpoch() - seconds });
        const pending = {
            emailAddress: 'ada@example.com',
            firstName: 'Ada',
            lastName: 'Lovelace',
            phoneNumber: `+1${phoneNumber}`,
        };
        const join = seconds => {
            userService.getUserByEmailAddressToken.mockResolvedValueOnce({
                displayName,
                membershipType,
                membership: { tokens: tokensAged(seconds), pending },
            });

            return userController.join({
                displayName,
                membershipType,
                tokens: { emailAddress: 'some-blob', phoneNumber: code },
            });
        };
        const decipher = seconds => {
            userService.getUserByDisplayName.mockResolvedValueOnce({
                dateRegistered: '2026-01-01T00:00:00.000Z',
                membership: { tokens: tokensAged(seconds) },
            });

            return userController.decipher({ displayName, membershipType, channel: 'phone', code });
        };

        const resend = seconds => {
            userService.getUserByDisplayName.mockResolvedValueOnce({
                displayName,
                membershipType,
                membership: { tokens: { ...tokensAged(seconds), blob: 'some-blob' }, pending },
            });

            return userController.resend({ displayName, membershipType, channel: 'phone' });
        };

        it('should accept a token up to 15 minutes old', async () => {
            await expect(join(895)).resolves.toBeDefined();
            await expect(decipher(895)).resolves.toBeDefined();

            /** `join` has just sent its welcome. */
            notificationService.sendMessage.mockClear();
            await resend(895);
            expect(notificationService.sendMessage).toHaveBeenCalledOnce();
        });

        it('should reject a token older than 15 minutes', async () => {
            await expect(join(905)).resolves.toBeUndefined();
            await expect(decipher(905)).rejects.toThrow('token expired');

            await resend(905);
            expect(notificationService.sendMessage).not.toHaveBeenCalled();
        });
    });

    describe('join', () => {
        const code = '424242';
        const pending = {
            emailAddress: 'ada@example.com',
            firstName: 'Ada',
            lastName: 'Lovelace',
            phoneNumber: '+12085550123',
        };
        const receipts = { message: { sid: 'SM-1' }, postmark: { messageId: '<m-1>' } };
        /** A saved sign-up, as `signUp` leaves it. */
        const signedUp = (overrides = {}) => ({
            id: 'doc-1',
            ...mockUser,
            membership: {
                tokens: { blob: 'some-token', code, timeStamp: getEpoch() },
                pending,
                ...receipts,
            },
            ...overrides,
        });
        const join = (
            tokens = { emailAddress: 'some-token', phoneNumber: code },
            account = { displayName, membershipType },
        ) => userController.join({ ...account, tokens });
        const saved = () => userService.updateUser.mock.calls.at(-1)?.[0];

        beforeEach(() => {
            userService.getUserByEmailAddress.mockResolvedValue(undefined);
            userService.getUserByPhoneNumber.mockResolvedValue(undefined);
        });

        afterEach(() => {
            userService.getUserByEmailAddressToken.mockReset();
            userService.getUserByEmailAddress.mockReset();
            userService.getUserByPhoneNumber.mockReset();
            userService.getUserByDisplayName.mockReset();
            readConsent.mockReset().mockResolvedValue(undefined);
        });

        describe('refusing', () => {
            it('should not look anything up without an email token', async () => {
                await expect(join({})).resolves.toBeUndefined();

                expect(userService.getUserByEmailAddressToken).not.toHaveBeenCalled();
            });

            it.each([
                ['no document holds the token', undefined],
                [
                    "an email cipher's blob, which has no code to match",
                    signedUp({
                        dateRegistered: '2026-01-01T00:00:00.000Z',
                        membership: { tokens: { blob: 'some-token', timeStamp: getEpoch() } },
                    }),
                ],
                [
                    'a sign-up with no pending contact (the old format)',
                    signedUp({
                        membership: { tokens: { blob: 'some-token', code, timeStamp: getEpoch() } },
                    }),
                ],
                [
                    'an expired sign-up',
                    signedUp({
                        membership: {
                            tokens: { blob: 'some-token', code, timeStamp: getEpoch() - 1000 },
                            pending,
                        },
                    }),
                ],
            ])('should refuse %s', async (_, document) => {
                /** Both attempts below read it, so not `Once`. */
                userService.getUserByEmailAddressToken.mockResolvedValue(document);

                /**
                 * The cipher case sends no code at all, which compared
                 * `undefined` with `undefined` before the code was checked to
                 * exist.
                 */
                await expect(join({ emailAddress: 'some-token' })).resolves.toBeUndefined();
                await expect(join()).resolves.toBeUndefined();
                expect(userService.updateUser).not.toHaveBeenCalled();
            });

            it('should refuse a wrong code', async () => {
                userService.getUserByEmailAddressToken.mockResolvedValueOnce(signedUp());

                await expect(
                    join({ emailAddress: 'some-token', phoneNumber: '000000' }),
                ).resolves.toBeUndefined();
                expect(userService.updateUser).not.toHaveBeenCalled();
            });

            it("should refuse another account's sign-up", async () => {
                userService.getUserByEmailAddressToken.mockResolvedValueOnce(signedUp());

                await expect(
                    join(undefined, { displayName: 'someone-else', membershipType }),
                ).resolves.toBeUndefined();
                expect(userService.updateUser).not.toHaveBeenCalled();
            });

            it.each([
                ['email', 'getUserByEmailAddress'],
                ['phone', 'getUserByPhoneNumber'],
            ])('should refuse when another account registered the %s since', async (_, lookup) => {
                userService.getUserByEmailAddressToken.mockResolvedValueOnce(signedUp());
                userService[lookup].mockResolvedValue({
                    id: 'doc-2',
                    dateRegistered: '2026-01-01T00:00:00.000Z',
                });

                await expect(join()).resolves.toBeUndefined();
                expect(userService.updateUser).not.toHaveBeenCalled();
                expect(logWarn).toHaveBeenCalledWith(
                    { displayName, membershipType },
                    'Not joining: the pending contact was registered by another account.',
                );
            });
        });

        describe('a first sign-up', () => {
            it('should register the account with the pending contact', async () => {
                userService.getUserByEmailAddressToken.mockResolvedValueOnce(signedUp());

                const user = await join();

                expect(user).toMatchObject(mockUser);
                expect(saved()).toMatchObject({ ...pending, dateRegistered: expect.any(String) });
                /** Tokens and pending contact are spent; receipts stay, for billing. */
                expect(saved().membership).toEqual(receipts);
                expect(notificationService.sendMessage).toHaveBeenCalledWith(
                    'Welcome! Message frequency varies. Msg & data rates may apply. Reply HELP for help, STOP to cancel.',
                    pending.phoneNumber,
                    '',
                );
            });

            it('should still join if sending the welcome message fails', async () => {
                notificationService.sendMessage.mockRejectedValueOnce(new Error('twilio error'));
                userService.getUserByEmailAddressToken.mockResolvedValueOnce(signedUp());

                await expect(join()).resolves.toBeDefined();
                expect(saved().dateRegistered).toBeDefined();
            });

            it('should subscribe the number by default', async () => {
                userService.getUserByEmailAddressToken.mockResolvedValueOnce(signedUp());

                await join();

                expect(readConsent).toHaveBeenCalledWith(pending.phoneNumber);
                expect(saved().isSubscribed).toBe(true);
            });

            it('should keep a STOP the number sent before joining, with its timestamp', async () => {
                /** No document held the pending number, so only the marker has it. */
                readConsent.mockResolvedValueOnce({ isSubscribed: false, receivedAt: 200 });
                userService.getUserByEmailAddressToken.mockResolvedValueOnce(signedUp());
                userService.getUserByDisplayName.mockResolvedValueOnce({
                    id: 'doc-1',
                    _etag: 'e2',
                });

                await join();

                expect(saved().isSubscribed).toBe(false);
                /** No welcome to a number that opted out. */
                expect(notificationService.sendMessage).not.toHaveBeenCalled();
                /**
                 * Through the write that sets the watermark: `updateUser`
                 * keeps the stored one, so a delayed START older than this
                 * STOP would otherwise still win.
                 */
                expect(userService.getUserByDisplayName).toHaveBeenCalledWith(
                    displayName,
                    membershipType,
                    true,
                );
                expect(userService.updateUserSubscription).toHaveBeenCalledExactlyOnceWith(
                    { id: 'doc-1', _etag: 'e2' },
                    false,
                    200,
                );
            });

            it('should still join when the consent stamp fails', async () => {
                readConsent.mockResolvedValueOnce({ isSubscribed: false, receivedAt: 200 });
                userService.getUserByEmailAddressToken.mockResolvedValueOnce(signedUp());
                userService.getUserByDisplayName.mockResolvedValueOnce({ id: 'doc-1' });
                userService.updateUserSubscription.mockRejectedValueOnce(new Error('412'));

                await expect(join()).resolves.toBeDefined();
                expect(saved().isSubscribed).toBe(false);
                expect(logError).toHaveBeenCalledWith(
                    expect.objectContaining({ displayName, membershipType }),
                    "Failed to stamp the new number's consent.",
                );
            });

            it('should stamp nothing without a consent marker', async () => {
                userService.getUserByEmailAddressToken.mockResolvedValueOnce(signedUp());

                await join();

                expect(userService.updateUserSubscription).not.toHaveBeenCalled();
            });

            it('should seed all known notification types', async () => {
                userService.getUserByEmailAddressToken.mockResolvedValueOnce(signedUp());

                await join();

                expect(saved().notifications).toEqual([
                    { enabled: false, type: 'Orders', messages: [] },
                    { enabled: false, type: 'Banshee-44', messages: [] },
                    { enabled: false, type: 'Lord Saladin', messages: [] },
                    { enabled: false, type: 'Xur', messages: [] },
                ]);
            });
        });

        describe('a registered account changing its contact', () => {
            const registered = (overrides = {}) =>
                signedUp({
                    dateRegistered: '2026-01-01T00:00:00.000Z',
                    emailAddress: 'old@example.com',
                    firstName: 'Ada',
                    lastName: 'Lovelace',
                    phoneNumber: '+12085550199',
                    isSubscribed: false,
                    notifications: [{ enabled: true, type: 'Xur', messages: [] }],
                    ...overrides,
                });

            it('should replace the contact and keep the registration', async () => {
                userService.getUserByEmailAddressToken.mockResolvedValueOnce(registered());

                await join();

                expect(saved()).toMatchObject({
                    ...pending,
                    dateRegistered: '2026-01-01T00:00:00.000Z',
                    notifications: [{ enabled: true, type: 'Xur', messages: [] }],
                });
                expect(saved().membership).toEqual(receipts);
                expect(notificationService.sendMessage).not.toHaveBeenCalled();
            });

            it("should not carry the old number's opt-out to a new number", async () => {
                userService.getUserByEmailAddressToken.mockResolvedValueOnce(registered());

                await join();

                expect(saved().isSubscribed).toBe(true);
            });

            it('should leave consent alone when the number is unchanged', async () => {
                userService.getUserByEmailAddressToken.mockResolvedValueOnce(
                    registered({ phoneNumber: pending.phoneNumber }),
                );

                await join();

                expect(readConsent).not.toHaveBeenCalled();
                expect(saved().isSubscribed).toBe(false);
            });

            it('should not count its own current contact as a conflict', async () => {
                userService.getUserByEmailAddressToken.mockResolvedValueOnce(registered());
                userService.getUserByEmailAddress.mockResolvedValue({
                    id: 'doc-1',
                    dateRegistered: '2026-01-01T00:00:00.000Z',
                });

                await expect(join()).resolves.toBeDefined();
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

                describe('when a previous move was marked but never completed', () => {
                    it('should restore the record instead of leaving it invisible', async () => {
                        userService.getUserByMembershipId.mockResolvedValue(undefined);
                        userService.getUserByBungieMembershipId.mockResolvedValue({
                            dateRegistered: Temporal.Now.instant().toString(),
                            ...mockUser,
                            movedTo: 3,
                        });

                        await userController.signIn({});

                        expect(userService.clearPlatformMove).toHaveBeenCalled();
                        expect(userService.movePlatform).not.toHaveBeenCalled();
                        expect(userService.updateUser).toHaveBeenCalled();
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
        const contact = {
            firstName: 'Ada',
            lastName: 'Lovelace',
            emailAddress: 'ada@example.com',
            phoneNumber,
        };
        const anonymous = { id: 'doc-1', displayName, membershipType, membershipId };
        const registered = {
            ...anonymous,
            dateRegistered: '2026-01-01T00:00:00.000Z',
            emailAddress: 'verified@example.com',
            firstName: 'Ada',
            lastName: 'Lovelace',
            phoneNumber: '+12085550199',
        };
        const signUp = (body = contact) =>
            userController.signUp({ displayName, membershipType, contact: body });
        const registeredElsewhere = { id: 'doc-2', dateRegistered: '2026-01-01T00:00:00.000Z' };

        beforeEach(() => {
            userService.getUserByEmailAddress.mockResolvedValue(undefined);
            userService.getUserByPhoneNumber.mockResolvedValue(undefined);
        });

        afterEach(() => {
            userService.getUserByDisplayName.mockReset();
            userService.getUserByEmailAddress.mockReset();
            userService.getUserByPhoneNumber.mockReset();
        });

        describe('when the account is not registered', () => {
            beforeEach(() => {
                userService.getUserByDisplayName.mockResolvedValue(anonymous);
            });

            it('should read the account past the cache', async () => {
                /**
                 * The writes merge this copy over a fresh read, so a stale
                 * cached one would put back old fields and fail on its ETag.
                 */
                await signUp();

                /** The first read: the receipt write reads past the cache too. */
                expect(userService.getUserByDisplayName).toHaveBeenNthCalledWith(
                    1,
                    displayName,
                    membershipType,
                    true,
                );
            });

            it('should save the contact as pending, with the tokens', async () => {
                await expect(signUp()).resolves.toBeDefined();

                /** No top-level contact, so not `updateUser`, whose schema requires it. */
                expect(userService.updateUser).not.toHaveBeenCalled();

                const [persisted] = userService.updateAnonymousUser.mock.calls[0];

                expect(persisted.membership.pending).toEqual({
                    ...contact,
                    phoneNumber: `+1${phoneNumber}`,
                });
                expect(persisted.membership.tokens).toEqual(
                    expect.objectContaining({ blob: expect.any(String), code: expect.any(String) }),
                );
                /**
                 * The top level is what every contact lookup reads, so it only
                 * ever holds verified contact.
                 */
                expect(persisted.emailAddress).toBeUndefined();
                expect(persisted.phoneNumber).toBeUndefined();
                /** Registration state belongs to `join`. */
                expect(persisted.dateRegistered).toBeUndefined();
                expect(persisted.notifications).toBeUndefined();
                expect(persisted.isSubscribed).toBeUndefined();
                expect(persisted.roles).toBeUndefined();
            });

            it('should send the codes to the pending contact', async () => {
                await signUp();

                expect(notificationService.sendMessage).toHaveBeenCalledWith(
                    expect.stringContaining('Reply HELP for help, STOP to cancel.'),
                    `+1${phoneNumber}`,
                    '',
                );

                const [recipient, , path] = userController.postmaster.register.mock.calls[0];

                expect(recipient).toMatchObject({
                    emailAddress: contact.emailAddress,
                    firstName: contact.firstName,
                });
                expect(recipient.membership.tokens.blob).toEqual(expect.any(String));
                expect(path).toEqual('/register');
            });

            it('should ignore server-owned fields a caller slips past the route', async () => {
                /**
                 * The route rejects these outright; this pins the second line
                 * of defence, so a future caller reaching the controller
                 * directly cannot reintroduce the hole.
                 */
                await signUp({
                    ...contact,
                    dateRegistered: '2020-01-01T00:00:00.000Z',
                    notifications: [{ enabled: true, type: 'Xur', messages: [] }],
                    roles: ['Admin'],
                });

                const [persisted] = userService.updateAnonymousUser.mock.calls[0];

                expect(persisted.dateRegistered).toBeUndefined();
                expect(persisted.notifications).toBeUndefined();
                expect(persisted.roles).toBeUndefined();
                expect(persisted.membership.pending).not.toHaveProperty('roles');
            });

            it('should reject an unusable phone number', async () => {
                /**
                 * The route decides the status code from the type, so a bare
                 * `Error` here would send an unusable number back as a 500.
                 */
                await expect(
                    signUp({ ...contact, phoneNumber: '+86 10 1234 5678' }),
                ).rejects.toBeInstanceOf(InvalidPhoneNumberError);
            });

            it.each([
                ['email', 'getUserByEmailAddress'],
                ['phone', 'getUserByPhoneNumber'],
            ])(
                'should send and save nothing when another account registered the %s',
                async (_, lookup) => {
                    userService[lookup].mockResolvedValue(registeredElsewhere);

                    await expect(signUp()).resolves.toBeUndefined();

                    expect(userService.updateAnonymousUser).not.toHaveBeenCalled();
                    expect(userService.updateUser).not.toHaveBeenCalled();
                    expect(notificationService.sendMessage).not.toHaveBeenCalled();
                    expect(userController.postmaster.register).not.toHaveBeenCalled();
                },
            );

            it('should count a registered holder as a conflict even when no ids are known', async () => {
                /**
                 * Two missing ids are equal, which once made any registered
                 * holder look like the account itself.
                 */
                userService.getUserByDisplayName.mockResolvedValue(undefined);
                userService.getUserByEmailAddress.mockResolvedValue({
                    dateRegistered: '2026-01-01T00:00:00.000Z',
                });

                await expect(signUp()).resolves.toBeUndefined();
            });
        });

        describe('when the account is registered', () => {
            beforeEach(() => {
                userService.getUserByDisplayName.mockResolvedValue(registered);
            });

            it('should save the new contact as pending and keep the verified contact', async () => {
                /** Re-signing up is how a registered account changes its contact. */
                await expect(signUp()).resolves.toEqual({ undelivered: [] });

                const [persisted] = userService.updateUser.mock.calls[0];

                expect(persisted).toMatchObject({
                    emailAddress: registered.emailAddress,
                    phoneNumber: registered.phoneNumber,
                    dateRegistered: registered.dateRegistered,
                });
                expect(persisted.membership.pending).toMatchObject({
                    emailAddress: contact.emailAddress,
                    phoneNumber: `+1${phoneNumber}`,
                });
                expect(userService.updateAnonymousUser).not.toHaveBeenCalled();
            });

            it('should not count its own current contact as a conflict', async () => {
                userService.getUserByEmailAddress.mockResolvedValue(registered);

                await expect(signUp()).resolves.toBeDefined();
                expect(notificationService.sendMessage).toHaveBeenCalled();
            });

            it("should not take another account's contact", async () => {
                userService.getUserByPhoneNumber.mockResolvedValue(registeredElsewhere);

                await expect(signUp()).resolves.toBeUndefined();
                expect(userService.updateUser).not.toHaveBeenCalled();
            });
        });

        describe('delivery', () => {
            const contact = {
                firstName: 'Ada',
                lastName: 'Lovelace',
                emailAddress: 'ada@example.com',
                phoneNumber,
            };
            const sms = { sid: 'SM-test-sid' };
            const email = { messageId: '<test-message-id@example.com>' };
            const signUp = () => userController.signUp({ displayName, membershipType, contact });

            /**
             * The account isn't registered, so its writes go through
             * `updateAnonymousUser`: its contact is pending, and `updateUser`'s
             * schema requires top-level contact.
             */
            const write = userService.updateAnonymousUser;

            /**
             * What Cosmos holds: each write replaces it, and a read
             * that skips the cache returns a copy with a fresh ETag. The
             * receipts are saved onto that read, so the specs below can see
             * whether a write in between survives.
             */
            let stored;

            beforeEach(() => {
                stored = undefined;
                userService.getUserByDisplayName.mockImplementation(() =>
                    Promise.resolve(
                        stored ? { ...structuredClone(stored), _etag: chance.guid() } : undefined,
                    ),
                );
                userService.getUserByEmailAddress.mockResolvedValue(undefined);
                userService.getUserByPhoneNumber.mockResolvedValue(undefined);
                for (const writer of [userService.updateUser, write]) {
                    writer.mockImplementation(user => {
                        stored = structuredClone(user);

                        return Promise.resolve(user);
                    });
                }
                notificationService.sendMessage.mockResolvedValue(sms);
                userController.postmaster.register.mockResolvedValue(email);
            });

            /**
             * These mocks are shared with the rest of the file, and
             * `clearMocks` resets calls, not implementations or a `Once`
             * value a failing case left unused.
             */
            afterEach(() => {
                userService.getUserByDisplayName.mockReset();
                userService.getUserByEmailAddress.mockReset();
                userService.getUserByPhoneNumber.mockReset();
                for (const writer of [userService.updateUser, write]) {
                    writer.mockReset().mockImplementation(user => Promise.resolve(user));
                }
                notificationService.sendMessage.mockReset().mockResolvedValue();
            });

            it('should save the tokens before sending either message', async () => {
                await signUp();

                const [firstWrite] = write.mock.invocationCallOrder;
                const [firstSms] = notificationService.sendMessage.mock.invocationCallOrder;
                const [firstEmail] = userController.postmaster.register.mock.invocationCallOrder;

                expect(firstWrite).toBeLessThan(firstSms);
                expect(firstWrite).toBeLessThan(firstEmail);

                const [persisted] = write.mock.calls[0];

                expect(persisted.membership.tokens).toEqual(
                    expect.objectContaining({
                        blob: expect.any(String),
                        code: expect.any(String),
                    }),
                );
            });

            it('should send nothing when the tokens cannot be saved', async () => {
                write.mockRejectedValueOnce(new Error('cosmos unavailable'));

                await expect(signUp()).rejects.toThrow('cosmos unavailable');

                expect(notificationService.sendMessage).not.toHaveBeenCalled();
                expect(userController.postmaster.register).not.toHaveBeenCalled();
            });

            it('should still send both when the manifest is unavailable', async () => {
                worldRepository.getVendorIcon.mockRejectedValueOnce(new Error('503'));

                await expect(signUp()).resolves.toEqual({ undelivered: [] });
            });

            it('should report nothing undelivered when both messages go out', async () => {
                await expect(signUp()).resolves.toEqual({ undelivered: [] });
            });

            it('should still send the email when the SMS fails', async () => {
                const err = new Error('twilio unavailable');

                notificationService.sendMessage.mockRejectedValueOnce(err);

                await expect(signUp()).resolves.toEqual({ undelivered: ['phone'] });

                expect(userController.postmaster.register).toHaveBeenCalled();
                expect(logError).toHaveBeenCalledWith(
                    { err, channel: 'phone', displayName, membershipType },
                    'Failed to send a sign-up verification message.',
                );
            });

            it('should still send the SMS when the email fails', async () => {
                userController.postmaster.register.mockRejectedValueOnce(
                    new Error('smtp unavailable'),
                );

                await expect(signUp()).resolves.toEqual({ undelivered: ['email'] });

                expect(notificationService.sendMessage).toHaveBeenCalled();
            });

            it('should report both channels when neither message goes out', async () => {
                notificationService.sendMessage.mockRejectedValueOnce(new Error('twilio'));
                userController.postmaster.register.mockRejectedValueOnce(new Error('smtp'));

                await expect(signUp()).resolves.toEqual({ undelivered: ['phone', 'email'] });

                /** Nothing went out, so there is nothing to bill. */
                expect(write).toHaveBeenCalledTimes(1);
            });

            it("should not bring back an earlier sign-up's codes when nothing goes out", async () => {
                stored = {
                    displayName,
                    membershipType,
                    emailAddress: 'earlier@example.com',
                    membership: {
                        tokens: { blob: 'earlier-blob', code: '111111', timeStamp: getEpoch() },
                    },
                };
                notificationService.sendMessage.mockRejectedValueOnce(new Error('twilio'));
                userController.postmaster.register.mockRejectedValueOnce(new Error('smtp'));

                await signUp();

                /**
                 * The earlier codes reached the earlier contact. Paired with
                 * the contact just saved, they would register an address and
                 * number nobody verified. A send that failed may also have
                 * been delivered, so the new codes stay.
                 */
                expect(stored.membership.pending.emailAddress).toEqual(contact.emailAddress);
                expect(stored.membership.tokens.blob).not.toEqual('earlier-blob');
                expect(stored.membership.tokens.code).not.toEqual('111111');
            });

            it('should save the receipts after sending, for billing', async () => {
                await signUp();

                expect(write).toHaveBeenCalledTimes(2);

                const [receipts] = write.mock.calls[1];

                expect(receipts.membership.message).toEqual(sms);
                expect(receipts.membership.postmark).toEqual(email);
                expect(receipts.membership.tokens).toEqual(stored.membership.tokens);
                /**
                 * Saved onto a fresh read, whose ETag guards the write against
                 * anything that changed the document since.
                 */
                expect(receipts._etag).toEqual(expect.any(String));
            });

            it('should save a receipt only for the channel that sent', async () => {
                userController.postmaster.register.mockRejectedValueOnce(new Error('smtp'));

                await signUp();

                const [receipts] = write.mock.calls[1];

                expect(receipts.membership.message).toEqual(sms);
                expect(receipts.membership).not.toHaveProperty('postmark');
            });

            it('should keep a write that lands while the messages are sending', async () => {
                notificationService.sendMessage.mockImplementationOnce(() => {
                    stored.firstName = 'Grace';

                    return Promise.resolve(sms);
                });

                await signUp();

                expect(stored.firstName).toEqual('Grace');
                expect(stored.membership.message).toEqual(sms);
            });

            it('should log, not save, its receipts when a join promotes the sign-up mid-send', async () => {
                /**
                 * A join spends the tokens, so the receipts no longer match
                 * a saved sign-up. They are logged with the provider's ids
                 * for reconciliation; an append-only record (#793) keeps them.
                 */
                notificationService.sendMessage.mockImplementationOnce(() => {
                    const { pending } = stored.membership;

                    Object.assign(stored, pending, { dateRegistered: '2026-11-03T00:00:00.000Z' });
                    stored.membership = {};

                    return Promise.resolve(sms);
                });

                await signUp();

                expect(stored).toMatchObject({
                    dateRegistered: '2026-11-03T00:00:00.000Z',
                    emailAddress: contact.emailAddress,
                });
                expect(stored.membership).toEqual({});
                expect(logWarn).toHaveBeenCalledWith(
                    expect.objectContaining({ sid: sms.sid, messageId: email.messageId }),
                    'The saved tokens have changed; not saving their receipts.',
                );
            });

            it('should not save its receipts onto a newer sign-up', async () => {
                const newer = { blob: 'newer-blob', code: '654321', timeStamp: 1 };

                notificationService.sendMessage.mockImplementationOnce(() => {
                    stored.membership.tokens = newer;

                    return Promise.resolve(sms);
                });

                await expect(signUp()).resolves.toEqual({ undelivered: [] });

                expect(write).toHaveBeenCalledTimes(1);
                expect(stored.membership.tokens).toEqual(newer);
                expect(logWarn).toHaveBeenCalledWith(
                    { displayName, membershipType, sid: sms.sid, messageId: email.messageId },
                    'The saved tokens have changed; not saving their receipts.',
                );
            });

            it('should still succeed when the receipts cannot be saved', async () => {
                const err = new Error('precondition failed');

                write
                    .mockImplementationOnce(user => {
                        stored = structuredClone(user);

                        return Promise.resolve(user);
                    })
                    .mockRejectedValueOnce(err);

                /**
                 * Both messages are out. Failing the request now would only
                 * invite a retry that sends, and bills, them again.
                 */
                await expect(signUp()).resolves.toEqual({ undelivered: [] });

                expect(logError).toHaveBeenCalledWith(
                    {
                        err,
                        displayName,
                        membershipType,
                        sid: sms.sid,
                        messageId: email.messageId,
                    },
                    'Failed to save verification delivery receipts.',
                );
            });
        });
    });

    describe('decipher', () => {
        it('should check the code against an uncached read', async () => {
            userService.getUserByDisplayName.mockResolvedValueOnce({
                displayName,
                membershipType,
                dateRegistered: '2026-01-01T00:00:00.000Z',
                membership: { tokens: { code: '123456', timeStamp: getEpoch() } },
            });

            await userController.decipher({
                displayName,
                membershipType,
                channel: 'phone',
                code: '123456',
            });

            expect(userService.getUserByDisplayName).toHaveBeenCalledWith(
                displayName,
                membershipType,
                true,
            );
        });

        it('should not construct without a consent reader', () => {
            /** Without it, a STOP sent between sign-up and `join` would be lost. */
            expect(
                () =>
                    new UserController({
                        allowCipherAttempt,
                        destinyService,
                        notificationService,
                        userService,
                        worldRepository,
                    }),
            ).toThrow(new TypeError('readConsent is required'));
        });

        it('should not construct without an attempt limit', () => {
            /** Without one, cryptarch would allow unlimited guesses. */
            expect(
                () =>
                    new UserController({
                        destinyService,
                        notificationService,
                        userService,
                        worldRepository,
                    }),
            ).toThrow(new TypeError('allowCipherAttempt is required'));
        });

        describe('attempts', () => {
            const timeStamp = getEpoch();
            const attempt = code =>
                userController.decipher({ displayName, membershipType, channel: 'phone', code });

            beforeEach(() => {
                userService.getUserByDisplayName.mockResolvedValue({
                    displayName,
                    membershipType,
                    dateRegistered: '2026-01-01T00:00:00.000Z',
                    membership: { tokens: { code: '123456', timeStamp } },
                });
            });

            afterEach(() => {
                userService.getUserByDisplayName.mockReset();
                allowCipherAttempt.mockReset().mockResolvedValue(true);
            });

            it("should spend one of the code's attempts, keyed on its account and token", async () => {
                await attempt('123456');

                expect(allowCipherAttempt).toHaveBeenCalledExactlyOnceWith(
                    expect.stringMatching(
                        new RegExp(`^${membershipType}:${displayName}:[0-9a-f]{64}$`),
                    ),
                );
                /** The code itself never reaches Redis. */
                expect(allowCipherAttempt.mock.calls[0][0]).not.toContain('123456');
            });

            it('should count two codes minted in the same second apart', async () => {
                await attempt('123456');
                userService.getUserByDisplayName.mockResolvedValue({
                    displayName,
                    membershipType,
                    dateRegistered: '2026-01-01T00:00:00.000Z',
                    membership: { tokens: { code: '654321', timeStamp } },
                });
                await attempt('654321');

                const [[first], [second]] = allowCipherAttempt.mock.calls;

                expect(first).not.toEqual(second);
            });

            it.each([
                ['tokens were saved', { tokens: { blob: 'b', code: '123456', timeStamp } }],
                ['a conflict saved none', undefined],
            ])(
                'should refuse an unregistered account before spending an attempt when %s',
                async (_, membership) => {
                    /**
                     * Both answer 404 for ever, so the attempt limit can't tell
                     * a saved sign-up from one that hit a conflict.
                     */
                    userService.getUserByDisplayName.mockResolvedValue({
                        displayName,
                        membershipType,
                        membership,
                    });

                    for (let i = 0; i < 6; i++) {
                        await expect(attempt('000000')).rejects.toBeInstanceOf(InvalidCipherError);
                    }
                    expect(allowCipherAttempt).not.toHaveBeenCalled();
                },
            );

            it("should refuse a registered account's pending re-sign-up codes", async () => {
                /**
                 * They went to the new, unverified contact, so they prove
                 * nothing about the registered one.
                 */
                userService.getUserByDisplayName.mockResolvedValue({
                    displayName,
                    membershipType,
                    dateRegistered: '2026-01-01T00:00:00.000Z',
                    membership: {
                        tokens: { blob: 'b', code: '123456', timeStamp },
                        pending: { phoneNumber: '+12085550123' },
                    },
                });

                await expect(attempt('123456')).rejects.toBeInstanceOf(InvalidCipherError);
                expect(allowCipherAttempt).not.toHaveBeenCalled();
            });

            it.each([
                ['email', { code: '123456' }],
                ['phone', { blob: 'some-blob' }],
            ])(
                'should refuse %s with no code when only the other channel has a token',
                async (channel, held) => {
                    userService.getUserByDisplayName.mockResolvedValue({
                        displayName,
                        membershipType,
                        dateRegistered: '2026-01-01T00:00:00.000Z',
                        membership: { tokens: { ...held, timeStamp } },
                    });

                    await expect(
                        userController.decipher({ displayName, membershipType, channel }),
                    ).rejects.toBeInstanceOf(InvalidCipherError);
                },
            );

            it('should spend an attempt on a wrong code too', async () => {
                await expect(attempt('000000')).rejects.toBeInstanceOf(InvalidCipherError);

                expect(allowCipherAttempt).toHaveBeenCalledOnce();
            });

            it('should refuse even the right code once the attempts are spent', async () => {
                allowCipherAttempt.mockResolvedValueOnce(false);

                await expect(attempt('123456')).rejects.toBeInstanceOf(CipherAttemptsExceededError);
            });

            it('should not spend an attempt on an expired code', async () => {
                userService.getUserByDisplayName.mockResolvedValue({
                    displayName,
                    membershipType,
                    dateRegistered: '2026-01-01T00:00:00.000Z',
                    membership: { tokens: { code: '123456', timeStamp: 1 } },
                });

                await expect(attempt('123456')).rejects.toBeInstanceOf(InvalidCipherError);

                expect(allowCipherAttempt).not.toHaveBeenCalled();
            });
        });
    });

    describe('resend', () => {
        const sms = { sid: 'SM-resend-sid' };
        const email = { messageId: '<resend-message-id@example.com>' };
        const resend = channel => userController.resend({ displayName, membershipType, channel });
        const pending = {
            emailAddress: 'ada@example.com',
            firstName: 'Ada',
            lastName: 'Lovelace',
            phoneNumber: `+1${phoneNumber}`,
        };
        /** An unregistered account's writes go through `updateAnonymousUser`. */
        const write = userService.updateAnonymousUser;
        let stored;
        let tokens;

        beforeEach(() => {
            tokens = { blob: 'pending-blob', code: '424242', timeStamp: getEpoch() };
            stored = {
                displayName,
                membershipType,
                membership: { tokens, pending, message: { sid: 'SM-original' } },
            };
            userService.getUserByDisplayName.mockImplementation(() =>
                Promise.resolve({ ...structuredClone(stored), _etag: chance.guid() }),
            );
            for (const writer of [userService.updateUser, write]) {
                writer.mockImplementation(user => {
                    stored = structuredClone(user);

                    return Promise.resolve(user);
                });
            }
            notificationService.sendMessage.mockResolvedValue(sms);
            userController.postmaster.register.mockResolvedValue(email);
        });

        afterEach(() => {
            userService.getUserByDisplayName.mockReset();
            for (const writer of [userService.updateUser, write]) {
                writer.mockReset().mockImplementation(user => Promise.resolve(user));
            }
            notificationService.sendMessage.mockReset().mockResolvedValue();
            userController.postmaster.register.mockReset();
        });

        it('should read the pending sign-up without the cache', async () => {
            await resend('phone');

            expect(userService.getUserByDisplayName).toHaveBeenNthCalledWith(
                1,
                displayName,
                membershipType,
                true,
            );
        });

        it('should send the same code by SMS only, keeping the tokens', async () => {
            await resend('phone');

            const [text, to] = notificationService.sendMessage.mock.calls[0];

            expect(text).toContain('424242');
            expect(text).toContain('Reply HELP for help, STOP to cancel.');
            expect(to).toEqual(`+1${phoneNumber}`);
            expect(userController.postmaster.register).not.toHaveBeenCalled();
            expect(stored.membership.tokens).toEqual(tokens);
        });

        it('should send the same link by email only, keeping the tokens', async () => {
            await resend('email');

            const [recipient, , path] = userController.postmaster.register.mock.calls[0];

            expect(recipient.membership.tokens.blob).toEqual('pending-blob');
            expect(path).toEqual('/register');
            expect(notificationService.sendMessage).not.toHaveBeenCalled();
            expect(stored.membership.tokens).toEqual(tokens);
        });

        it.each([
            ['phone', 'message', sms],
            ['email', 'postmark', email],
        ])('should save the %s receipt, for billing', async (channel, field, receipt) => {
            await resend(channel);

            expect(stored.membership[field]).toEqual(receipt);
        });

        it.each([
            [
                'there is no user',
                () => {
                    stored = undefined;
                },
            ],
            [
                'a registered account has no pending sign-up',
                () => {
                    stored.dateRegistered = '2026-01-01T00:00:00.000Z';
                    delete stored.membership.pending;
                },
            ],
            [
                'only a cipher is pending',
                () => {
                    delete stored.membership.tokens.blob;
                    delete stored.membership.pending;
                },
            ],
            [
                'the tokens have no pending contact (the old format)',
                () => {
                    delete stored.membership.pending;
                },
            ],
            [
                'there are no tokens',
                () => {
                    delete stored.membership;
                },
            ],
            [
                'the tokens have expired',
                () => {
                    stored.membership.tokens.timeStamp = 1;
                },
            ],
        ])('should send and save nothing when %s', async (_, arrange) => {
            arrange();
            userService.getUserByDisplayName.mockImplementation(() =>
                Promise.resolve(stored && structuredClone(stored)),
            );

            await expect(resend('phone')).resolves.toBeUndefined();

            expect(notificationService.sendMessage).not.toHaveBeenCalled();
            expect(userService.updateUser).not.toHaveBeenCalled();
            expect(write).not.toHaveBeenCalled();
            expect(logInfo).toHaveBeenCalledWith(
                { displayName, membershipType, channel: 'phone' },
                'No pending sign-up to resend.',
            );
        });

        it("should resend a registered account's contact change to the new contact", async () => {
            stored = {
                ...stored,
                dateRegistered: '2026-01-01T00:00:00.000Z',
                emailAddress: 'old@example.com',
                phoneNumber: '+12085550199',
            };

            await resend('phone');

            const [, to] = notificationService.sendMessage.mock.calls[0];

            expect(to).toEqual(pending.phoneNumber);
            /** Registered, so the receipt goes through `updateUser`. */
            expect(userService.updateUser).toHaveBeenCalledOnce();
            expect(stored.membership.message).toEqual(sms);
        });

        it('should still send, without an icon, when the manifest is unavailable', async () => {
            /**
             * Only the path with a sign-up to send for looks the icon up, so
             * a 503 here would answer differently from a conflict.
             */
            worldRepository.getVendorIcon.mockRejectedValueOnce(
                Object.assign(new Error('manifest unavailable'), { statusCode: 503 }),
            );

            await expect(resend('email')).resolves.toBeUndefined();

            const [, image] = userController.postmaster.register.mock.calls[0];

            expect(image).toBeUndefined();
            expect(logWarn).toHaveBeenCalledWith(
                { err: expect.any(Error) },
                'No vendor icon for the verification message.',
            );
        });

        it('should resolve, and only log, when the send fails', async () => {
            const err = new Error('twilio unavailable');

            notificationService.sendMessage.mockRejectedValueOnce(err);

            await expect(resend('phone')).resolves.toBeUndefined();

            expect(userService.updateUser).not.toHaveBeenCalled();
            expect(write).not.toHaveBeenCalled();
            expect(logError).toHaveBeenCalledWith(
                { err, displayName, membershipType, channel: 'phone' },
                'Failed to resend a sign-up verification message.',
            );
        });
    });

    describe('sendCipher', () => {
        const sms = { sid: 'SM-cipher-sid' };
        const email = { messageId: '<cipher-message-id@example.com>' };
        const send = channel => userController.sendCipher({ displayName, membershipType, channel });
        const sender = {
            phone: () => notificationService.sendMessage,
            email: () => userController.postmaster.confirm,
        };
        const receiptField = { phone: 'message', email: 'postmark' };
        const receiptFor = { phone: sms, email };

        /**
         * What Cosmos holds, as in signUp's 'delivery' specs: each
         * `updateUser` replaces it, and a read returns a copy with a fresh
         * ETag.
         */
        let stored;

        beforeEach(() => {
            stored = {
                displayName,
                emailAddress: 'some-email-address',
                dateRegistered: Temporal.Now.instant().toString(),
                membershipType,
                phoneNumber: `+1${phoneNumber}`,
                membership: { tokens: { code: '000000', timeStamp: 1 } },
            };
            userService.getUserByDisplayName.mockImplementation(() =>
                Promise.resolve({ ...structuredClone(stored), _etag: chance.guid() }),
            );
            userService.updateUser.mockImplementation(user => {
                stored = structuredClone(user);

                return Promise.resolve(user);
            });
            notificationService.sendMessage.mockResolvedValue(sms);
            userController.postmaster.confirm.mockResolvedValue(email);
        });

        afterEach(() => {
            userService.getUserByDisplayName.mockReset();
            userService.updateUser.mockReset().mockImplementation(user => Promise.resolve(user));
            notificationService.sendMessage.mockReset().mockResolvedValue();
        });

        it('should send a compliant verification message', async () => {
            await send('phone');

            expect(notificationService.sendMessage).toHaveBeenCalledWith(
                expect.stringContaining('Reply HELP for help, STOP to cancel.'),
                `+1${phoneNumber}`,
                '',
            );
        });

        it('should read the user it is about to write without the cache', async () => {
            await send('phone');

            expect(userService.getUserByDisplayName).toHaveBeenNthCalledWith(
                1,
                displayName,
                membershipType,
                true,
            );
        });

        it('should reject a user who is not registered', async () => {
            delete stored.dateRegistered;

            await expect(send('phone')).rejects.toThrow('registration not found');

            expect(userService.updateUser).not.toHaveBeenCalled();
            expect(notificationService.sendMessage).not.toHaveBeenCalled();
        });

        describe.each(['phone', 'email'])('when channel is %s', channel => {
            const token = channel === 'phone' ? 'code' : 'blob';

            it('should save the new token before sending it', async () => {
                await send(channel);

                const [firstWrite] = userService.updateUser.mock.invocationCallOrder;
                const [firstSend] = sender[channel]().mock.invocationCallOrder;

                expect(firstWrite).toBeLessThan(firstSend);

                const [persisted] = userService.updateUser.mock.calls[0];
                const saved = persisted.membership.tokens[token];

                expect(saved).toEqual(expect.any(String));

                /** What went out is what was saved. */
                if (channel === 'phone') {
                    const [text] = notificationService.sendMessage.mock.calls[0];

                    expect(text).toContain(saved);
                } else {
                    const [recipient] = userController.postmaster.confirm.mock.calls[0];

                    expect(recipient.membership.tokens.blob).toEqual(saved);
                }
            });

            it('should send nothing when the token cannot be saved', async () => {
                userService.updateUser.mockRejectedValueOnce(new Error('precondition failed'));

                await expect(send(channel)).rejects.toThrow('precondition failed');

                expect(sender[channel]()).not.toHaveBeenCalled();
            });

            it('should reject when the send fails, keeping the saved token', async () => {
                sender[channel]().mockRejectedValueOnce(new Error('provider unavailable'));

                await expect(send(channel)).rejects.toThrow('provider unavailable');

                /**
                 * A failed send may still have been delivered, so the token
                 * stays; the user asks again. Nothing went out to bill.
                 */
                expect(userService.updateUser).toHaveBeenCalledTimes(1);
                expect(stored.membership.tokens).toEqual(
                    userService.updateUser.mock.calls[0][0].membership.tokens,
                );
            });

            it('should save the receipt onto a fresh read, for billing', async () => {
                await send(channel);

                expect(userService.updateUser).toHaveBeenCalledTimes(2);

                const [saved] = userService.updateUser.mock.calls[1];

                expect(saved.membership[receiptField[channel]]).toEqual(receiptFor[channel]);
                expect(saved.membership.tokens).toEqual(
                    userService.updateUser.mock.calls[0][0].membership.tokens,
                );
                expect(saved._etag).toEqual(expect.any(String));
            });

            it('should not save the receipt onto a newer token', async () => {
                const newer = { [token]: 'newer-token', timeStamp: 2 };

                sender[channel]().mockImplementationOnce(() => {
                    stored.membership.tokens = newer;

                    return Promise.resolve(receiptFor[channel]);
                });

                await send(channel);

                expect(userService.updateUser).toHaveBeenCalledTimes(1);
                expect(stored.membership.tokens).toEqual(newer);
                expect(logWarn).toHaveBeenCalledWith(
                    expect.objectContaining({ displayName, membershipType }),
                    'The saved tokens have changed; not saving their receipts.',
                );
            });

            it('should still succeed when the receipt cannot be saved', async () => {
                const err = new Error('cosmos unavailable');

                userService.updateUser
                    .mockImplementationOnce(user => {
                        stored = structuredClone(user);

                        return Promise.resolve(user);
                    })
                    .mockRejectedValueOnce(err);

                await expect(send(channel)).resolves.toBeUndefined();

                expect(logError).toHaveBeenCalledWith(
                    expect.objectContaining({ err, displayName, membershipType }),
                    'Failed to save verification delivery receipts.',
                );
            });
        });

        it('should not save a phone receipt onto a newer phone code', async () => {
            /**
             * Phone tokens have no blob, so a guard on the blob alone would
             * match any two phone codes.
             */
            notificationService.sendMessage.mockImplementationOnce(() => {
                stored.membership.tokens = {
                    ...stored.membership.tokens,
                    code: 'newer-code',
                };

                return Promise.resolve(sms);
            });

            await send('phone');

            expect(userService.updateUser).toHaveBeenCalledTimes(1);
            expect(stored.membership.tokens.code).toEqual('newer-code');
        });

        it('should not save a phone receipt onto a newer code that repeats the digits', async () => {
            /**
             * Six digits repeat about once in a million ciphers; the
             * timestamp still tells the two apart.
             */
            notificationService.sendMessage.mockImplementationOnce(() => {
                stored.membership.tokens = {
                    ...stored.membership.tokens,
                    timeStamp: stored.membership.tokens.timeStamp + 1,
                };

                return Promise.resolve(sms);
            });

            await send('phone');

            expect(userService.updateUser).toHaveBeenCalledTimes(1);
            expect(stored.membership).not.toHaveProperty('message');
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
        updateDocument: vi.fn((_collection, document) => Promise.resolve(document)),
    };

    let controller;

    beforeEach(() => {
        vi.clearAllMocks();

        controller = new UserController({
            allowCipherAttempt,
            readConsent,
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

    /**
     * The case a `movePlatform` unit test could not reach. After a failed
     * delete both copies carry the same Bungie id, so the lookup `signIn` falls
     * through to used to throw - and the player could never sign in again.
     */
    describe('when a player moves back to a platform whose superseded copy survived', () => {
        const supersededXbox = {
            _etag: 'a-etag',
            bungie: { access_token: 'old', membership_id: 'bungie-net-99' },
            dateRegistered: '2026-01-01T00:00:00Z',
            displayName: 'XboxGamertag',
            id: 'user-1',
            membershipId: 'xbox-membership',
            membershipType: 1,
            movedTo: 3,
            phoneNumber: '+12085551234',
        };
        const liveSteam = {
            ...supersededXbox,
            _etag: 'b-etag',
            displayName: 'SteamPersona',
            membershipId: 'steam-membership',
            membershipType: 3,
            movedTo: undefined,
        };

        beforeEach(() => {
            post.mockResolvedValue({
                access_token: 'some-access-token',
                expires_in: 3600,
                membership_id: 'bungie-net-99',
                refresh_token: 'some-refresh-token',
            });
            // Bungie now reports Xbox as the owner again.
            get.mockResolvedValueOnce({
                ErrorCode: 1,
                Response: {
                    destinyMemberships: [
                        {
                            crossSaveOverride: 1,
                            displayName: 'XboxGamertag',
                            membershipId: 'xbox-membership',
                            membershipType: 1,
                        },
                    ],
                },
            });
            documentService.getDocuments.mockImplementation((_collection, query) =>
                Promise.resolve(
                    query.query.includes('bungie.membership_id') ? [supersededXbox, liveSteam] : [],
                ),
            );
            documentService.createDocument.mockRejectedValue(
                Object.assign(new Error('conflict'), { code: 409 }),
            );
        });

        it('should sign them in rather than throwing', async () => {
            await expect(controller.signIn({ code: 'some-code' })).resolves.toMatchObject({
                displayName: 'XboxGamertag',
                membershipType: 1,
            });
        });

        it('should bring the Xbox record back to life and retire the Steam one', async () => {
            await controller.signIn({ code: 'some-code' });

            const replace = documentService.updateDocument.mock.calls.at(-1);

            expect(replace[1]).toMatchObject({ membershipType: 1, id: 'user-1' });
            expect(replace[1]).not.toHaveProperty('movedTo');
            expect(replace[2]).toBe(1);
            expect(documentService.deleteDocumentById).toHaveBeenCalledWith('Users', 'user-1', 3);
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
