/**
 * User Service Tests
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Chance from 'chance';
import UserService from './user.service.js';
import log from '../helpers/log.js';

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
                    Promise.resolve([user, user]),
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
                    Promise.resolve([user, user]),
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
                    Promise.resolve([user, user]),
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
                    Promise.resolve([user, user]),
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
                    Promise.resolve([user, user]),
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
                    Promise.resolve([user, user]),
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
