/**
 * User Service Tests
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Chance from 'chance';
import UserService from './user.service.js';
import log from '../helpers/log.js';

const cacheService = {
    deleteUser: vi.fn(),
    getUser: vi.fn(),
    setUser: vi.fn(),
};
const chance = new Chance();
const documentService = {
    createDocument: vi.fn(),
    deleteDocumentById: vi.fn(),
    getDocuments: vi.fn(),
    getDocumentsPage: vi.fn(),
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

    afterEach(() => {
        vi.restoreAllMocks();
    });

    describe('addUserMessage', () => {
        beforeEach(() => {
            documentService.updateDocument.mockImplementation(() => Promise.resolve());
            userService.getUserByDisplayName = vi.fn().mockResolvedValue(user);
        });

        it('should add the message to the database collection', async () => {
            const inputDateString = '2020-04-25T18:00:00.000Z';
            const expectedDateString = '2020-04-25T18:00:00.000Z';
            const message = {
                SmsSid: 'SM11',
                SmsStatus: 'sent',
                To: '+1234567890',
            };

            vi.spyOn(Temporal.Now, 'instant').mockReturnValueOnce(
                Temporal.Instant.from(inputDateString),
            );

            await userService.addUserMessage(message);

            expect(documentService.createDocument).toHaveBeenCalledWith('Messages', {
                DateTime: expectedDateString,
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

                const { membershipId: _membershipId, ...anonymousUserWithoutMembershipId } =
                    anonymousUser;

                await expect(
                    userService.createAnonymousUser(anonymousUserWithoutMembershipId),
                ).rejects.toThrow(undefined);
            });
        });

        describe.each([
            ['Xbox', 1],
            ['PlayStation Network', 2],
            ['Steam', 3],
            ['Epic Games Store', 6],
        ])('when the anonymous user is on %s', (_platform, membershipType) => {
            it('should create the anonymous user', async () => {
                userService.getUserByDisplayName = vi.fn().mockResolvedValue();

                await userService.createAnonymousUser({ ...anonymousUser, membershipType });

                expect(documentService.createDocument).toHaveBeenCalledWith(
                    'Users',
                    expect.objectContaining({ membershipType }),
                );
            });
        });

        describe.each([
            ['None', 0],
            ['Blizzard, migrated to Steam in 2019', 4],
            ['Stadia, retired in 2023', 5],
            ['BungieNext, not a playable platform', 254],
        ])('when the membership type is %s', (_platform, membershipType) => {
            it('should reject without creating a partial user', async () => {
                userService.getUserByDisplayName = vi.fn().mockResolvedValue();

                await expect(
                    userService.createAnonymousUser({ ...anonymousUser, membershipType }),
                ).rejects.toThrow();

                expect(documentService.createDocument).not.toHaveBeenCalled();
            });
        });

        describe('when the display name is a 32 character Steam persona name', () => {
            it('should create the anonymous user', async () => {
                userService.getUserByDisplayName = vi.fn().mockResolvedValue();

                const displayName = chance.string({ length: 32, alpha: true });

                await userService.createAnonymousUser({
                    ...anonymousUser,
                    displayName,
                    membershipType: 3,
                });

                expect(documentService.createDocument).toHaveBeenCalledWith(
                    'Users',
                    expect.objectContaining({ displayName }),
                );
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

                    return userService.createAnonymousUser(anonymousUser).then(() => {
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
                const { phoneNumber: _phoneNumber, ...userWithoutPhoneNumber } = user;

                await expect(userService.createUser(userWithoutPhoneNumber)).rejects.toThrow(
                    undefined,
                );
            });

            it('should reject a notification with an unrecognized type', async () => {
                const userWithInvalidNotification = {
                    ...user,
                    notifications: [{ enabled: true, type: 'NotARealType' }],
                };

                await expect(userService.createUser(userWithInvalidNotification)).rejects.toThrow(
                    undefined,
                );
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
                documentService.getDocuments.mockImplementationOnce(() =>
                    Promise.resolve(messages.filter(({ SmsStatus }) => SmsStatus !== 'delivered')),
                );
                documentService.getDocuments.mockImplementation(() =>
                    Promise.resolve(messages.filter(({ SmsStatus }) => SmsStatus === 'delivered')),
                );

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

                return userService
                    .getUserByDisplayName(user.displayName, user.membershipType)
                    .then(user1 => {
                        expect(cacheService.getUser).toHaveBeenCalled();
                        expect(user1.displayName).toEqual(user.displayName);
                        expect(documentService.getDocuments).not.toHaveBeenCalled();
                    });
            });
        });

        describe('when display name and membership type are not valid', () => {
            it('should throw', async () => {
                await expect(
                    userService.getUserByDisplayName(user.membershipType, user.displayName),
                ).rejects.toThrow(
                    'Invalid input: expected string, received number,Invalid input: expected number, received string',
                );
            });
        });

        describe('when display name and membership type are defined', () => {
            it('should return an existing user', () => {
                cacheService.getUser.mockImplementation(() => Promise.resolve());
                documentService.getDocuments.mockImplementation(() => Promise.resolve([user]));

                return userService
                    .getUserByDisplayName(user.displayName, user.membershipType)
                    .then(user1 => {
                        expect(user1.displayName).toEqual(user.displayName);
                        expect(documentService.getDocuments).toHaveBeenCalled();
                    });
            });

            it('should fail when more than one existing user is found', async () => {
                documentService.getDocuments.mockImplementation(() =>
                    Promise.resolve([
                        { ...user, id: 'user-a' },
                        { ...user, id: 'user-b' },
                    ]),
                );

                await expect(
                    userService.getUserByDisplayName(user.displayName, user.membershipType),
                ).rejects.toThrow();

                expect(documentService.getDocuments).toHaveBeenCalled();
            });

            it('should return undefined if user is not found', () => {
                documentService.getDocuments.mockImplementation(() => Promise.resolve([]));

                return userService
                    .getUserByDisplayName('unknownDisplayName', user.membershipType)
                    .then(user1 => {
                        expect(user1).toBeUndefined();
                        expect(documentService.getDocuments).toHaveBeenCalled();
                    });
            });

            it('should fail when display name is empty', async () => {
                await expect(userService.getUserByDisplayName()).rejects.toThrow();
            });

            it('should fail when membership type is not a number', async () => {
                await expect(
                    userService.getUserByDisplayName(user.displayName, ''),
                ).rejects.toThrow();
            });

            it('should fail when no documents are returned', async () => {
                documentService.getDocuments.mockImplementation(() => Promise.resolve());

                await expect(
                    userService.getUserByDisplayName(user.displayName, user.membershipType),
                ).rejects.toThrow();

                expect(documentService.getDocuments).toHaveBeenCalled();
            });
        });
    });

    describe('getUserByEmailAddress', () => {
        describe('when email address and membership type are defined', () => {
            it('should return an existing user', () => {
                documentService.getDocuments.mockImplementation(() => Promise.resolve([user]));

                return userService.getUserByEmailAddress(user.emailAddress).then(user1 => {
                    expect(user1).toEqual(user);
                    expect(documentService.getDocuments).toHaveBeenCalled();
                });
            });

            it('should fail when more than one existing user is found', async () => {
                documentService.getDocuments.mockImplementation(() =>
                    Promise.resolve([
                        { ...user, id: 'user-a' },
                        { ...user, id: 'user-b' },
                    ]),
                );

                await expect(
                    userService.getUserByEmailAddress(user.emailAddress),
                ).rejects.toThrow();

                expect(documentService.getDocuments).toHaveBeenCalled();
            });

            it('should fail when no users are found', () => {
                documentService.getDocuments.mockImplementation(() => Promise.resolve([]));

                return userService.getUserByEmailAddress(user.emailAddress).then(user1 => {
                    expect(user1).toBeUndefined();
                    expect(documentService.getDocuments).toHaveBeenCalled();
                });
            });

            it('should fail when email address is empty', async () => {
                documentService.getDocuments.mockImplementation(() => Promise.resolve());

                await expect(userService.getUserByEmailAddress()).rejects.toThrow();

                expect(documentService.getDocuments).not.toHaveBeenCalled();
            });

            it('should fail when no documents are found', async () => {
                documentService.getDocuments.mockImplementation(() => Promise.resolve());

                await expect(
                    userService.getUserByEmailAddress(user.emailAddress),
                ).rejects.toThrow();

                expect(documentService.getDocuments).toHaveBeenCalled();
            });
        });
    });

    describe('getUserByEmailAddressToken', () => {
        describe('when email address token is defined', () => {
            it('should return an existing user', () => {
                documentService.getDocuments.mockImplementation(() => Promise.resolve([user]));

                return userService.getUserByEmailAddressToken('some_token').then(user1 => {
                    expect(user1).toEqual(user);
                    expect(documentService.getDocuments).toHaveBeenCalled();
                });
            });

            it('should fail when more than one existing user is found', async () => {
                documentService.getDocuments.mockImplementation(() =>
                    Promise.resolve([
                        { ...user, id: 'user-a' },
                        { ...user, id: 'user-b' },
                    ]),
                );

                await expect(
                    userService.getUserByEmailAddressToken('some_token'),
                ).rejects.toThrow();

                expect(documentService.getDocuments).toHaveBeenCalled();
            });

            it('should fail when no users are found', () => {
                documentService.getDocuments.mockImplementation(() => Promise.resolve([]));

                return userService.getUserByEmailAddressToken('some_token').then(user1 => {
                    expect(user1).toBeUndefined();
                    expect(documentService.getDocuments).toHaveBeenCalled();
                });
            });

            it('should fail when email address token is empty', async () => {
                documentService.getDocuments.mockImplementation(() => Promise.resolve());

                await expect(userService.getUserByEmailAddressToken()).rejects.toThrow();

                expect(documentService.getDocuments).not.toHaveBeenCalled();
            });

            it('should fail when no documents are found', async () => {
                documentService.getDocuments.mockImplementation(() => Promise.resolve());

                await expect(
                    userService.getUserByEmailAddressToken('some_token'),
                ).rejects.toThrow();

                expect(documentService.getDocuments).toHaveBeenCalled();
            });
        });
    });

    /**
     * What every other lookup does while a `movePlatform` delete has not
     * landed. The superseded copy carries `movedTo`, so it is not the live
     * record however recently it was written to - which matters because an old
     * session or a move back to the original platform can write to it, and a
     * timestamp rule would then hand back the consent it never received.
     */
    describe('when an unfinished platform move has left a superseded copy', () => {
        // Deliberately the *newer* of the two, which is what a timestamp rule got wrong.
        const superseded = { ...user, _ts: 9999, id: 'user-1', membershipType: 1, movedTo: 3 };
        const live = { ...user, _ts: 1000, id: 'user-1', membershipType: 3 };

        beforeEach(() => {
            documentService.getDocuments.mockResolvedValue([superseded, live]);
            cacheService.setUser.mockResolvedValue();
        });

        it('should keep the phone-number lookup working, which STOP handling runs on', async () => {
            await expect(userService.getUserByPhoneNumber(user.phoneNumber, true)).resolves.toEqual(
                live,
            );
        });

        it('should give the consent gate the live record, not the superseded one', async () => {
            await expect(userService.getConsentByPhoneNumber(user.phoneNumber)).resolves.toEqual(
                live,
            );
        });

        it('should keep the id, e-mail and displayName lookups working', async () => {
            await expect(userService.getUserById('user-1')).resolves.toEqual(live);
            await expect(userService.getUserByEmailAddress(user.emailAddress)).resolves.toEqual(
                live,
            );
            await expect(userService.getUserByDisplayName(user.displayName, 3)).resolves.toEqual(
                live,
            );
        });

        /**
         * The write path a session predating the move goes through. It must not
         * find the superseded copy, or the write lands on a record nothing reads.
         */
        it('should hide the superseded copy from a lookup on the old platform', async () => {
            documentService.getDocuments.mockResolvedValue([superseded]);

            await expect(
                userService.getUserByDisplayName(user.displayName, 1),
            ).resolves.toBeUndefined();
            await expect(userService.getUserByMembershipId('11')).resolves.toBeUndefined();
        });

        /**
         * The exception, and the reason `signIn` can recover: a move that never
         * created its successor would otherwise leave the player invisible.
         */
        it('should expose a lone superseded copy to the Bungie-id lookup', async () => {
            documentService.getDocuments.mockResolvedValue([superseded]);

            await expect(userService.getUserByBungieMembershipId('99')).resolves.toEqual(
                superseded,
            );
        });

        /**
         * Both copies carry the same Bungie id after a failed delete. Throwing
         * here made every sign-in fail for a player moving back to their old
         * platform, because that is the lookup `signIn` falls through to.
         */
        it('should prefer the live copy over the superseded one, not throw', async () => {
            await expect(userService.getUserByBungieMembershipId('99')).resolves.toEqual(live);
        });

        it('should still throw when two live documents match', async () => {
            documentService.getDocuments.mockResolvedValue([
                { ...user, id: 'user-a' },
                { ...user, id: 'user-b' },
            ]);

            await expect(userService.getUserById('user-a')).rejects.toThrow(
                'more than 1 document found',
            );
        });
    });

    describe('clearPlatformMove', () => {
        it('should take the mark off and cache the restored record', async () => {
            const marked = { ...user, _etag: 'e', id: 'user-1', membershipType: 3, movedTo: 1 };

            documentService.updateDocument.mockImplementation((_c, document) =>
                Promise.resolve(document),
            );
            cacheService.setUser.mockResolvedValue();

            await userService.clearPlatformMove(marked);

            const [, document, partitionKey] = documentService.updateDocument.mock.calls[0];

            expect(document).not.toHaveProperty('movedTo');
            expect(partitionKey).toBe(3);
        });
    });

    describe('getUserByBungieMembershipId', () => {
        it('should return the user whose stored token carries that id', async () => {
            documentService.getDocuments.mockResolvedValue([user]);

            await expect(userService.getUserByBungieMembershipId('99')).resolves.toEqual(user);
        });

        it('should query on the Bungie membership id, not the platform one', async () => {
            documentService.getDocuments.mockResolvedValue([user]);

            await userService.getUserByBungieMembershipId('99');

            const [, query] = documentService.getDocuments.mock.calls[0];

            expect(query.query).toContain('bungie.membership_id');
            expect(query.parameters).toEqual([{ name: '@membership_id', value: '99' }]);
        });

        it('should return undefined when nothing matches', async () => {
            documentService.getDocuments.mockResolvedValue([]);

            await expect(userService.getUserByBungieMembershipId('99')).resolves.toBeUndefined();
        });

        it('should fail when two genuinely different users match', async () => {
            documentService.getDocuments.mockResolvedValue([
                { ...user, id: 'user-a' },
                { ...user, id: 'user-b' },
            ]);

            await expect(userService.getUserByBungieMembershipId('99')).rejects.toThrow();
        });

        /**
         * Unlike its siblings, which reject. This is a fallback behind
         * `getUserByMembershipId`, so a missing id means "nothing more to try":
         * rejecting would turn a brand-new user whose token lacked the field
         * into a failed sign-in.
         */
        it('should resolve undefined for a missing id without querying', async () => {
            await expect(userService.getUserByBungieMembershipId('')).resolves.toBeUndefined();
            await expect(
                userService.getUserByBungieMembershipId(undefined),
            ).resolves.toBeUndefined();

            expect(documentService.getDocuments).not.toHaveBeenCalled();
        });
    });

    describe('movePlatform', () => {
        const storedUser = {
            ...user,
            _etag: 'some-etag',
            _rid: 'some-rid',
            _self: 'some-self',
            _attachments: 'attachments/',
            _ts: 1700000000,
            dateRegistered: '2026-01-01T00:00:00Z',
            id: 'user-1',
            membershipId: '11',
            membershipType: 1,
        };
        const steamMembership = {
            displayName: 'SteamPersona',
            membershipId: '4611686018400000000',
            membershipType: 3,
            profilePicturePath: '/thing1',
        };

        beforeEach(() => {
            documentService.createDocument.mockImplementation((_collection, document) =>
                Promise.resolve({ ...document, _etag: 'new-etag' }),
            );
            documentService.updateDocument.mockImplementation((_collection, document) =>
                Promise.resolve(document),
            );
            documentService.deleteDocumentById.mockResolvedValue();
            cacheService.deleteUser.mockResolvedValue();
            cacheService.setUser.mockResolvedValue();
        });

        it('should mark the old copy before anything is duplicated', async () => {
            const { promise: markPending, resolve: finishMark } = Promise.withResolvers();

            documentService.updateDocument.mockReturnValue(markPending);

            const moving = userService.movePlatform(storedUser, steamMembership);

            await Promise.resolve();

            expect(documentService.updateDocument).toHaveBeenCalledWith(
                'Users',
                expect.objectContaining({ id: 'user-1', movedTo: 3 }),
                1,
            );
            expect(documentService.createDocument).not.toHaveBeenCalled();

            finishMark({});
            await moving;
        });

        it('should mark unconditionally, so a concurrent move does not fail its precondition', async () => {
            await userService.movePlatform(storedUser, steamMembership);

            const [, document] = documentService.updateDocument.mock.calls[0];

            expect(document).not.toHaveProperty('_etag');
        });

        it('should clear the cache even when the move fails after the mark', async () => {
            documentService.createDocument.mockRejectedValue(
                Object.assign(new Error('boom'), { code: 500 }),
            );

            await expect(userService.movePlatform(storedUser, steamMembership)).rejects.toThrow(
                'boom',
            );

            expect(cacheService.deleteUser).toHaveBeenCalledWith(storedUser);
        });

        it('should abort with nothing duplicated when the mark cannot be written', async () => {
            documentService.updateDocument.mockRejectedValue(new Error('cosmos unavailable'));

            await expect(userService.movePlatform(storedUser, steamMembership)).rejects.toThrow(
                'cosmos unavailable',
            );

            expect(documentService.createDocument).not.toHaveBeenCalled();
            expect(documentService.deleteDocumentById).not.toHaveBeenCalled();
        });

        it('should not carry the mark onto the record it creates', async () => {
            await userService.movePlatform({ ...storedUser, movedTo: 3 }, steamMembership);

            const [, document] = documentService.createDocument.mock.calls[0];

            expect(document).not.toHaveProperty('movedTo');
        });

        it('should create the record under the new platform, carrying the registration', async () => {
            await userService.movePlatform(storedUser, steamMembership);

            expect(documentService.createDocument).toHaveBeenCalledWith(
                'Users',
                expect.objectContaining({
                    displayName: 'SteamPersona',
                    membershipType: 3,
                    membershipId: '4611686018400000000',
                    // the whole point of the move: registration survives it
                    dateRegistered: '2026-01-01T00:00:00Z',
                    phoneNumber: storedUser.phoneNumber,
                    emailAddress: storedUser.emailAddress,
                    id: 'user-1',
                }),
            );
        });

        it('should not carry the old Cosmos system properties onto the new record', async () => {
            await userService.movePlatform(storedUser, steamMembership);

            const [, document] = documentService.createDocument.mock.calls[0];

            expect(document).not.toHaveProperty('_etag');
            expect(document).not.toHaveProperty('_rid');
            expect(document).not.toHaveProperty('_self');
            expect(document).not.toHaveProperty('_attachments');
            expect(document).not.toHaveProperty('_ts');
        });

        it('should delete the old record from its own partition', async () => {
            await userService.movePlatform(storedUser, steamMembership);

            expect(documentService.deleteDocumentById).toHaveBeenCalledWith('Users', 'user-1', 1);
        });

        it('should create before deleting, so a failure leaves a duplicate and not a gap', async () => {
            const { promise: createPending, resolve: finishCreate } = Promise.withResolvers();

            documentService.createDocument.mockReturnValue(createPending);

            const moving = userService.movePlatform(storedUser, steamMembership);

            await Promise.resolve();

            expect(documentService.deleteDocumentById).not.toHaveBeenCalled();

            finishCreate({ ...storedUser, ...steamMembership });
            await moving;

            expect(documentService.deleteDocumentById).toHaveBeenCalled();
        });

        it('should still resolve when the old record cannot be removed', async () => {
            const errorLog = vi.spyOn(log, 'error').mockImplementation(() => {});

            documentService.deleteDocumentById.mockRejectedValue(
                Object.assign(new Error('cosmos unavailable'), { code: 503 }),
            );

            vi.useFakeTimers();

            const moving = userService.movePlatform(storedUser, steamMembership);

            await vi.runAllTimersAsync();

            await expect(moving).resolves.toBeDefined();
            expect(errorLog).toHaveBeenCalled();

            vi.useRealTimers();
            errorLog.mockRestore();
        });

        it('should not retry a status that will never succeed', async () => {
            const errorLog = vi.spyOn(log, 'error').mockImplementation(() => {});

            documentService.deleteDocumentById.mockRejectedValue(
                Object.assign(new Error('forbidden'), { code: 403 }),
            );

            await expect(
                userService.movePlatform(storedUser, steamMembership),
            ).resolves.toBeDefined();

            expect(documentService.deleteDocumentById).toHaveBeenCalledTimes(1);
            expect(errorLog).toHaveBeenCalled();

            errorLog.mockRestore();
        });

        it('should clear the old cache keys before caching the moved record', async () => {
            await userService.movePlatform(storedUser, steamMembership);

            expect(cacheService.deleteUser).toHaveBeenCalledWith(storedUser);
            expect(cacheService.deleteUser.mock.invocationCallOrder[0]).toBeLessThan(
                cacheService.setUser.mock.invocationCallOrder[0],
            );
        });

        it('should retry a delete on a status that can clear on its own', async () => {
            vi.useFakeTimers();

            const errorLog = vi.spyOn(log, 'error').mockImplementation(() => {});

            documentService.deleteDocumentById
                .mockRejectedValueOnce(Object.assign(new Error('throttled'), { code: 429 }))
                .mockResolvedValueOnce();

            const moving = userService.movePlatform(storedUser, steamMembership);

            await vi.runAllTimersAsync();
            await moving;

            expect(documentService.deleteDocumentById).toHaveBeenCalledTimes(2);
            expect(errorLog).not.toHaveBeenCalled();

            errorLog.mockRestore();
            vi.useRealTimers();
        });

        it('should not retry a delete that 404s, because the copy is already gone', async () => {
            const errorLog = vi.spyOn(log, 'error').mockImplementation(() => {});

            documentService.deleteDocumentById.mockRejectedValue(
                Object.assign(new Error('not found'), { code: 404 }),
            );

            await expect(
                userService.movePlatform(storedUser, steamMembership),
            ).resolves.toBeDefined();

            expect(documentService.deleteDocumentById).toHaveBeenCalledTimes(1);
            expect(errorLog).not.toHaveBeenCalled();

            errorLog.mockRestore();
        });

        /**
         * Either a concurrent sign-in moved first, or the player is moving back
         * to a platform they left and the superseded copy is still sitting
         * there. Replacing brings the target back to life in both cases.
         */
        it('should replace the target when the create conflicts, then delete the source', async () => {
            documentService.createDocument.mockRejectedValue(
                Object.assign(new Error('conflict'), { code: 409 }),
            );

            await expect(
                userService.movePlatform(storedUser, steamMembership),
            ).resolves.toMatchObject({ membershipType: 3 });

            const replace = documentService.updateDocument.mock.calls.at(-1);

            expect(replace[1]).not.toHaveProperty('movedTo');
            expect(replace[2]).toBe(3);
            expect(documentService.deleteDocumentById).toHaveBeenCalledWith('Users', 'user-1', 1);
        });

        it('should surface a create failure that is not a conflict', async () => {
            documentService.createDocument.mockRejectedValue(
                Object.assign(new Error('boom'), { code: 500 }),
            );

            await expect(userService.movePlatform(storedUser, steamMembership)).rejects.toThrow(
                'boom',
            );

            expect(documentService.deleteDocumentById).not.toHaveBeenCalled();
        });

        it('should reject an unsupported platform without writing anything', async () => {
            await expect(
                userService.movePlatform(storedUser, { ...steamMembership, membershipType: 5 }),
            ).rejects.toThrow();

            expect(documentService.createDocument).not.toHaveBeenCalled();
            expect(documentService.deleteDocumentById).not.toHaveBeenCalled();
        });
    });

    describe('getUserByMembershipId', () => {
        describe('when membership Id is defined', () => {
            it('should return an existing user', () => {
                documentService.getDocuments.mockImplementation(() => Promise.resolve([user]));

                return userService.getUserByMembershipId(user.membershipId).then(user1 => {
                    expect(user1).toEqual(user);
                    expect(documentService.getDocuments).toHaveBeenCalled();
                });
            });

            it('should fail when more than one existing user is found', async () => {
                documentService.getDocuments.mockImplementation(() =>
                    Promise.resolve([
                        { ...user, id: 'user-a' },
                        { ...user, id: 'user-b' },
                    ]),
                );

                await expect(
                    userService.getUserByMembershipId(user.membershipId),
                ).rejects.toThrow();

                expect(documentService.getDocuments).toHaveBeenCalled();
            });

            it('should fail when no users are found', () => {
                documentService.getDocuments.mockImplementation(() => Promise.resolve([]));

                return userService.getUserByMembershipId(user.membershipId).then(user1 => {
                    expect(user1).toBeUndefined();
                    expect(documentService.getDocuments).toHaveBeenCalled();
                });
            });

            it('should fail when email address is empty', async () => {
                documentService.getDocuments.mockImplementation(() => Promise.resolve());

                await expect(userService.getUserByMembershipId()).rejects.toThrow();

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

    describe('getConsentByPhoneNumber', () => {
        const consent = { isSubscribed: false, notifications: user.notifications };

        it('should project to the consent fields rather than selecting the document', async () => {
            documentService.getDocuments.mockResolvedValueOnce([consent]);

            await userService.getConsentByPhoneNumber(user.phoneNumber);

            const [collectionId, query] = documentService.getDocuments.mock.calls[0];

            expect(collectionId).toBe('Users');
            expect(query.query).toBe(
                'SELECT r.movedTo, r.isSubscribed, r.notifications, r.consentUpdatedAt FROM root r WHERE r.phoneNumber = @phoneNumber',
            );
            expect(query.parameters).toEqual([{ name: '@phoneNumber', value: user.phoneNumber }]);
        });

        it('should return the projection', async () => {
            documentService.getDocuments.mockResolvedValueOnce([consent]);

            await expect(userService.getConsentByPhoneNumber(user.phoneNumber)).resolves.toEqual(
                consent,
            );
        });

        /**
         * The gate exists to see a STOP the cache could still be an hour behind
         * on, and a two-field projection must never be written back over the
         * full cached document.
         */
        it('should neither read nor write the cache', async () => {
            documentService.getDocuments.mockResolvedValueOnce([consent]);

            await userService.getConsentByPhoneNumber(user.phoneNumber);

            expect(cacheService.getUser).not.toHaveBeenCalled();
            expect(cacheService.setUser).not.toHaveBeenCalled();
        });

        it('should return undefined when the number matches no account', async () => {
            documentService.getDocuments.mockResolvedValueOnce([]);

            await expect(
                userService.getConsentByPhoneNumber(user.phoneNumber),
            ).resolves.toBeUndefined();
        });

        it('should reject when more than one document matches', async () => {
            documentService.getDocuments.mockResolvedValueOnce([consent, consent]);

            await expect(userService.getConsentByPhoneNumber(user.phoneNumber)).rejects.toThrow(
                /more than 1 document/,
            );
        });

        it('should reject an empty phone number without querying', async () => {
            await expect(userService.getConsentByPhoneNumber()).rejects.toThrow();

            expect(documentService.getDocuments).not.toHaveBeenCalled();
        });
    });

    describe('getUserByPhoneNumber', () => {
        describe('when user is cached', () => {
            it('should return cached user', () => {
                cacheService.getUser.mockImplementationOnce(() => Promise.resolve(user));

                return userService.getUserByPhoneNumber(user.phoneNumber).then(user1 => {
                    expect(cacheService.getUser).toHaveBeenCalled();
                    expect(user1.displayName).toEqual(user.displayName);
                    expect(documentService.getDocuments).not.toHaveBeenCalled();
                });
            });
        });

        describe('when the cache is bypassed', () => {
            it('should read through to Cosmos and refresh the cached document', async () => {
                const stored = { ...structuredClone(user), _etag: 'fresh-etag' };

                documentService.getDocuments.mockResolvedValueOnce([stored]);

                const result = await userService.getUserByPhoneNumber(user.phoneNumber, true);

                expect(cacheService.getUser).not.toHaveBeenCalled();
                expect(documentService.getDocuments).toHaveBeenCalled();
                expect(result._etag).toBe('fresh-etag');
                /**
                 * The bypassing read still writes back, so the stale entry
                 * heals itself rather than needing an explicit invalidation.
                 */
                expect(cacheService.setUser).toHaveBeenCalledWith(stored);
            });
        });

        describe('when phone number is found', () => {
            it('should return an existing user', () => {
                documentService.getDocuments.mockImplementation(() => Promise.resolve([user]));

                return userService.getUserByPhoneNumber(user.phoneNumber).then(user1 => {
                    expect(user1).toEqual(user);
                    expect(documentService.getDocuments).toHaveBeenCalled();
                });
            });

            it('should fail when more than one existing user is found', async () => {
                documentService.getDocuments.mockImplementation(() =>
                    Promise.resolve([
                        { ...user, id: 'user-a' },
                        { ...user, id: 'user-b' },
                    ]),
                );

                await expect(userService.getUserByPhoneNumber(user.phoneNumber)).rejects.toThrow();

                expect(documentService.getDocuments).toHaveBeenCalled();
            });

            it('should fail when no users are found', () => {
                documentService.getDocuments.mockImplementation(() => Promise.resolve([]));

                return userService.getUserByPhoneNumber(user.phoneNumber).then(user1 => {
                    expect(user1).toBeUndefined();
                    expect(documentService.getDocuments).toHaveBeenCalled();
                });
            });

            it('should fail when phone number is empty', async () => {
                documentService.getDocuments.mockImplementation(() => Promise.resolve());

                await expect(userService.getUserByPhoneNumber()).rejects.toThrow();

                expect(documentService.getDocuments).not.toHaveBeenCalled();
            });

            it('should fail when no documents are found', async () => {
                documentService.getDocuments.mockImplementation(() => Promise.resolve());

                await expect(userService.getUserByPhoneNumber(user.phoneNumber)).rejects.toThrow();

                expect(documentService.getDocuments).toHaveBeenCalled();
            });
        });
    });

    describe('getSubscribedUsers', () => {
        describe('when notificationType is not valid', () => {
            it('should reject', async () => {
                await expect(userService.getSubscribedUsers('not-a-type')).rejects.toThrow();
            });
        });

        describe('when notificationType is valid', () => {
            it('should include a user missing the isSubscribed field', async () => {
                documentService.getDocuments.mockImplementation(() =>
                    Promise.resolve([{ ...user, isSubscribed: undefined }]),
                );

                const users = await userService.getSubscribedUsers('Xur');

                expect(users).toHaveLength(1);
            });

            it('should exclude a user who has opted out', async () => {
                documentService.getDocuments.mockImplementation(() =>
                    Promise.resolve([
                        { ...user, isSubscribed: false },
                        { ...user, isSubscribed: true },
                    ]),
                );

                const users = await userService.getSubscribedUsers('Xur');

                expect(users).toHaveLength(1);
                expect(users[0].isSubscribed).toBe(true);
            });
        });
    });

    describe('getSubscribedUsersPage', () => {
        it('should reject a type there are no subscriptions for', async () => {
            await expect(userService.getSubscribedUsersPage('not-a-type')).rejects.toThrow();
            expect(documentService.getDocumentsPage).not.toHaveBeenCalled();
        });

        it('should read the page the cursor names, with the same query as getSubscribedUsers', async () => {
            documentService.getDocuments.mockResolvedValue([]);
            documentService.getDocumentsPage.mockResolvedValue({
                items: [],
                continuationToken: undefined,
            });

            await userService.getSubscribedUsers('Xur');
            await userService.getSubscribedUsersPage('Xur', 'page-2');

            const [[, query]] = documentService.getDocuments.mock.calls;

            expect(documentService.getDocumentsPage).toHaveBeenCalledExactlyOnceWith(
                'Users',
                query,
                { continuationToken: 'page-2', maxItemCount: 100 },
            );
        });

        it('should drop opted-out users and hand back the next cursor', async () => {
            documentService.getDocumentsPage.mockResolvedValue({
                items: [
                    { ...user, isSubscribed: false },
                    { ...user, isSubscribed: undefined },
                ],
                continuationToken: 'page-3',
            });

            const page = await userService.getSubscribedUsersPage('Xur', 'page-2');

            expect(page.users).toHaveLength(1);
            expect(page.cursor).toBe('page-3');
        });
    });

    describe('getUserById', () => {
        describe('when user id defined', () => {
            it('should return an existing user', () => {
                documentService.getDocuments.mockImplementation(() => Promise.resolve([user]));

                return userService.getUserById(user.id).then(user1 => {
                    expect(user1).toEqual(user);
                    expect(documentService.getDocuments).toHaveBeenCalled();
                });
            });

            it('should fail when more than one existing user is found', async () => {
                documentService.getDocuments.mockImplementation(() =>
                    Promise.resolve([
                        { ...user, id: 'user-a' },
                        { ...user, id: 'user-b' },
                    ]),
                );

                await expect(userService.getUserById(user.id)).rejects.toThrow();

                expect(documentService.getDocuments).toHaveBeenCalled();
            });

            it('should fail when no users are found', () => {
                documentService.getDocuments.mockImplementation(() => Promise.resolve([]));

                return userService.getUserById(user.id).then(user1 => {
                    expect(user1).toBeUndefined();
                    expect(documentService.getDocuments).toHaveBeenCalled();
                });
            });

            it('should fail when user id is empty', async () => {
                documentService.getDocuments.mockImplementation(() => Promise.resolve());

                await expect(userService.getUserById()).rejects.toThrow();

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
                    const user1 = structuredClone(user);
                    documentService.updateDocument.mockImplementation(() => Promise.resolve());

                    user1.firstName = chance.first();

                    userService.getUserByDisplayName = vi.fn().mockResolvedValue(user);

                    return userService.updateUser(user1).then(user2 => {
                        expect(user2).toBeUndefined();
                        expect(documentService.updateDocument).toHaveBeenCalledWith(
                            expect.anything(),
                            user1,
                            user1.membershipType,
                        );
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

                    await expect(userService.updateUser(user1)).rejects.toThrow();

                    expect(documentService.updateDocument).not.toHaveBeenCalled();
                });
            });
        });
    });

    describe('protecting the consent watermark from caller input', () => {
        /**
         * The sign-up route hands `updateUser` a raw request body. A planted
         * far-future stamp would make `applyConsent` treat every real STOP as
         * already superseded - acknowledged to the sender, never written, and
         * the number left in the next broadcast.
         */
        const PLANTED = 9_999_999_999_999;

        it('should discard a caller-supplied watermark on updateUser', async () => {
            const stored = { ...structuredClone(user), consentUpdatedAt: 1_000 };

            documentService.updateDocument.mockResolvedValue(undefined);
            userService.getUserByDisplayName = vi.fn().mockResolvedValue(stored);

            await userService.updateUser({
                ...structuredClone(user),
                consentUpdatedAt: PLANTED,
            });

            expect(documentService.updateDocument).toHaveBeenCalledWith(
                expect.anything(),
                expect.objectContaining({ consentUpdatedAt: 1_000 }),
                expect.anything(),
            );
        });

        it('should not let a caller introduce a watermark where none was stored', async () => {
            const stored = structuredClone(user);

            delete stored.consentUpdatedAt;
            documentService.updateDocument.mockResolvedValue(undefined);
            userService.getUserByDisplayName = vi.fn().mockResolvedValue(stored);

            await userService.updateUser({
                ...structuredClone(user),
                consentUpdatedAt: PLANTED,
            });

            const [, written] = documentService.updateDocument.mock.calls[0];

            expect(written.consentUpdatedAt).toBeUndefined();
        });

        it('should discard a caller-supplied watermark on updateAnonymousUser', async () => {
            const stored = { ...structuredClone(user), consentUpdatedAt: 1_000 };

            documentService.updateDocument.mockResolvedValue(undefined);
            userService.getUserByDisplayName = vi.fn().mockResolvedValue(stored);

            await userService.updateAnonymousUser({
                ...structuredClone(anonymousUser),
                consentUpdatedAt: PLANTED,
            });

            expect(documentService.updateDocument).toHaveBeenCalledWith(
                expect.anything(),
                expect.objectContaining({ consentUpdatedAt: 1_000 }),
                expect.anything(),
            );
        });
    });

    describe('updateUserSubscription', () => {
        it('should write the document in hand without a second lookup', async () => {
            const userDocument = structuredClone(user);

            documentService.updateDocument.mockResolvedValue(undefined);
            userService.getUserByDisplayName = vi.fn();

            await userService.updateUserSubscription(userDocument, false, 1_700_000_000_000);

            expect(userDocument.isSubscribed).toBe(false);
            expect(documentService.updateDocument).toHaveBeenCalledWith(
                expect.anything(),
                userDocument,
                userDocument.membershipType,
            );
            expect(cacheService.setUser).toHaveBeenCalledWith(userDocument);
            expect(userService.getUserByDisplayName).not.toHaveBeenCalled();
        });

        it('should cache the document Cosmos returns, carrying its new etag', async () => {
            const userDocument = { ...structuredClone(user), _etag: 'stale-etag' };
            const replaced = { ...userDocument, isSubscribed: false, _etag: 'fresh-etag' };

            documentService.updateDocument.mockResolvedValue(replaced);

            await userService.updateUserSubscription(userDocument, false, 1_700_000_000_000);

            /**
             * Caching the local copy instead would leave the next consent
             * change reading `stale-etag` and failing its IfMatch precondition.
             */
            expect(cacheService.setUser).toHaveBeenCalledWith(replaced);
            expect(cacheService.setUser).not.toHaveBeenCalledWith(
                expect.objectContaining({ _etag: 'stale-etag' }),
            );
        });

        it('should stamp the supplied arrival time on the document it writes', async () => {
            const userDocument = { ...structuredClone(user), _etag: 'etag-1' };
            const replaced = { ...userDocument, isSubscribed: false, _etag: 'etag-2' };

            documentService.updateDocument.mockResolvedValue(replaced);

            await userService.updateUserSubscription(userDocument, false, 1_700_000_000_000);

            /**
             * This stamp is what lets a later write tell a newer intent from a
             * stale job resuming after its backoff. If it stops being
             * persisted, stale consent silently starts winning again.
             */
            expect(userDocument.consentUpdatedAt).toBe(1_700_000_000_000);
            expect(documentService.updateDocument).toHaveBeenCalledWith(
                expect.anything(),
                expect.objectContaining({
                    isSubscribed: false,
                    consentUpdatedAt: 1_700_000_000_000,
                }),
                userDocument.membershipType,
            );
            expect(cacheService.setUser).toHaveBeenCalledWith(replaced);
        });

        it('should persist to Cosmos even when the cache is unreachable', async () => {
            const userDocument = { ...structuredClone(user), _etag: 'etag-1' };
            const warnLog = vi.spyOn(log, 'warn').mockImplementation(() => {});

            documentService.updateDocument.mockResolvedValue({ ...userDocument, _etag: 'etag-2' });
            cacheService.setUser.mockRejectedValue(new Error('ECONNREFUSED'));

            try {
                /**
                 * The SMS consent fallback runs *because* Redis is down, so a
                 * rejection here would fail the write that exists to survive
                 * exactly that. Cosmos is the source of truth; a cache that
                 * cannot be reached costs a repeat lookup, not the operation.
                 */
                await expect(
                    userService.updateUserSubscription(userDocument, false, 1_700_000_000_000),
                ).resolves.toBeUndefined();

                expect(documentService.updateDocument).toHaveBeenCalled();
                expect(warnLog).toHaveBeenCalledWith(
                    expect.objectContaining({ userId: userDocument.id }),
                    expect.stringContaining('Failed to cache the user'),
                );
            } finally {
                warnLog.mockRestore();
            }
        });

        it('should return a looked-up user when the cache write fails', async () => {
            const stored = { ...structuredClone(user), _etag: 'etag-9' };
            const warnLog = vi.spyOn(log, 'warn').mockImplementation(() => {});

            documentService.getDocuments.mockResolvedValueOnce([stored]);
            cacheService.setUser.mockRejectedValue(new Error('ECONNREFUSED'));

            try {
                await expect(
                    userService.getUserByPhoneNumber(user.phoneNumber, true),
                ).resolves.toEqual(stored);
            } finally {
                warnLog.mockRestore();
            }
        });

        it('should reject when the write fails so the caller can retry', async () => {
            const throttled = Object.assign(new Error('Request rate is large'), { code: 429 });

            documentService.updateDocument.mockRejectedValue(throttled);

            await expect(
                userService.updateUserSubscription(structuredClone(user), false, 1_700_000_000_000),
            ).rejects.toBe(throttled);

            expect(cacheService.setUser).not.toHaveBeenCalled();
        });
    });

    describe('updateUserBungie', () => {
        describe('when user id exists', () => {
            it('should return undefined', () => {
                documentService.updateDocument.mockImplementation(() => Promise.resolve());

                /**
                 * A clone, because `updateUserBungie` assigns onto the document
                 * it is handed - resolving the shared fixture here left every
                 * later test parsing a user whose `bungie` had no access token.
                 */
                userService.getUserById = vi.fn().mockResolvedValue(structuredClone(user));

                return userService.updateUserBungie(user.id, {}).then(user1 => {
                    expect(user1).toBeUndefined();
                    expect(documentService.updateDocument).toHaveBeenCalledWith(
                        expect.anything(),
                        expect.objectContaining({ id: user.id, bungie: {} }),
                        user.membershipType,
                    );
                });
            });
        });

        describe('when user id does not exist', () => {
            it('should not modify user document', async () => {
                documentService.updateDocument.mockImplementation(() => Promise.resolve());

                userService.getUserById = vi.fn().mockResolvedValue();

                await expect(userService.updateUserBungie(user.id)).rejects.toThrow();

                expect(documentService.updateDocument).not.toHaveBeenCalled();
            });
        });
    });

    describe('caching what Cosmos returns', () => {
        /**
         * Stands in for Cosmos' IfMatch precondition: a replace succeeds only
         * when the incoming document carries the etag the previous write
         * issued, and every success stamps a new one.
         */
        function mockCosmosEtags(startingEtag) {
            let currentEtag = startingEtag;

            documentService.updateDocument.mockImplementation(async (_collection, document) => {
                if (document._etag !== currentEtag) {
                    throw Object.assign(new Error('precondition failed'), { code: 412 });
                }

                currentEtag = `${currentEtag}+1`;

                return { ...document, _etag: currentEtag };
            });
        }

        /** Mirrors the real cache closely enough to be read back. */
        function mockCacheHolding(document) {
            let cached = document;

            cacheService.setUser.mockImplementation(async stored => {
                cached = stored;
            });

            return () => cached;
        }

        it('lets a second update inside the cache TTL succeed', async () => {
            mockCosmosEtags('etag-1');
            const readCache = mockCacheHolding({ ...structuredClone(user), _etag: 'etag-1' });
            userService.getUserByDisplayName = vi.fn(async () => readCache());

            await userService.updateUser({ ...structuredClone(user), firstName: 'first' });

            /**
             * Before this fix the cache still held `etag-1` here, so the second
             * write failed its precondition and surfaced as a 500.
             */
            await expect(
                userService.updateUser({ ...structuredClone(user), firstName: 'second' }),
            ).resolves.toBeUndefined();

            expect(readCache()._etag).toBe('etag-1+1+1');
        });

        it('caches the stored document from updateAnonymousUser, not the local merge', async () => {
            mockCosmosEtags('etag-1');
            userService.getUserByDisplayName = vi
                .fn()
                .mockResolvedValue({ ...structuredClone(user), _etag: 'etag-1' });

            await userService.updateAnonymousUser(structuredClone(anonymousUser));

            expect(cacheService.setUser).toHaveBeenCalledWith(
                expect.objectContaining({ _etag: 'etag-1+1' }),
            );
        });

        it('refreshes the cache from updateUserBungie, which previously never wrote to it', async () => {
            mockCosmosEtags('etag-1');
            userService.getUserById = vi
                .fn()
                .mockResolvedValue({ ...structuredClone(user), _etag: 'etag-1' });
            const bungie = { access_token: 'fresh-token' };

            await userService.updateUserBungie(user.id, bungie);

            expect(cacheService.setUser).toHaveBeenCalledExactlyOnceWith(
                expect.objectContaining({ _etag: 'etag-1+1', bungie }),
            );
        });

        it('falls back to the local document when the driver returns nothing', async () => {
            const userDocument = { ...structuredClone(user), _etag: 'etag-1' };

            documentService.updateDocument.mockResolvedValue(undefined);
            userService.getUserByDisplayName = vi.fn().mockResolvedValue(userDocument);

            await userService.updateUser(structuredClone(user));

            expect(cacheService.setUser).toHaveBeenCalledWith(userDocument);
        });
    });
});
