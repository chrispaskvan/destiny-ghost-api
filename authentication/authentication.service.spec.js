/**
 * Destiny Service Tests
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Chance from 'chance';
import AuthenticationService from './authentication.service.js';
import usersJson from '../mocks/users.json';

const [mockUser] = usersJson;

const cacheService = {
    getUser: vi.fn(),
    setUser: vi.fn().mockResolvedValue(),
};
const chance = new Chance();
const destinyService = {
    getAccessTokenFromRefreshToken: vi.fn(),
    getCurrentUser: vi.fn(),
};
const userService = {
    getUserByDisplayName: vi.fn(),
    getUserByPhoneNumber: vi.fn(),
    updateUserBungie: vi.fn(),
};

let authenticationService;

beforeEach(() => {
    authenticationService = new AuthenticationService({
        cacheService,
        destinyService,
        userService,
    });
});

afterEach(() => {
    vi.restoreAllMocks();
});

const user1 = structuredClone(mockUser);

describe('AuthenticationService', () => {
    describe('constructor', () => {
        it('required dependencies are injected', () => {
            const options = {
                cacheService: {},
                destinyService: {},
                userService: {},
            };

            authenticationService = new AuthenticationService(options);

            expect(authenticationService.cacheService).toEqual(options.cacheService);
            expect(authenticationService.destinyService).toEqual(options.destinyService);
            expect(authenticationService.userService).toEqual(options.userService);
        });
    });

    describe('authenticate', () => {
        const displayName = chance.word();
        const membershipType = 2;

        beforeEach(async () => {
            cacheService.getUser.mockImplementation(() => Promise.resolve(mockUser));
            userService.getUserByDisplayName.mockImplementation(() => Promise.resolve(mockUser));
            userService.getUserByPhoneNumber.mockImplementation(() => Promise.resolve(mockUser));
            userService.updateUserBungie.mockImplementation(() => Promise.resolve());
        });

        describe('when current user is fresh', () => {
            beforeEach(async () => {
                destinyService.getCurrentUser = vi.fn().mockResolvedValue(mockUser);
            });

            describe('when displayName and membershipType exist', () => {
                describe('when user exists', () => {
                    describe('when token is fresh', () => {
                        it('should return a user', async () => {
                            cacheService.setUser.mockImplementationOnce(() => Promise.resolve());

                            const user = await authenticationService.authenticate({
                                displayName,
                                membershipType,
                            });

                            expect(user).toEqual(user1);
                            expect(cacheService.setUser).not.toHaveBeenCalled();
                        });
                    });
                });

                describe('when user does not exist', () => {
                    beforeEach(async () => {
                        cacheService.getUser = vi.fn().mockResolvedValueOnce();
                        userService.getUserByDisplayName = vi.fn().mockResolvedValue();
                    });

                    it('should return undefined', async () => {
                        const user = await authenticationService.authenticate({
                            displayName,
                            membershipType,
                        });

                        expect(user).toBeUndefined();
                    });
                });
            });

            describe('when displayName and membershipType do not exist', () => {
                const phoneNumber = chance.phone();

                describe('when user exists', () => {
                    describe('when token is fresh', () => {
                        describe('when the user is cached', () => {
                            it('should return the cached user user', async () => {
                                const user = await authenticationService.authenticate({
                                    phoneNumber,
                                });

                                expect(user).toEqual(user1);
                                expect(cacheService.setUser).not.toHaveBeenCalled();
                                expect(userService.getUserByPhoneNumber).not.toHaveBeenCalled();
                            });
                        });
                        describe('when the user is not cached', () => {
                            beforeEach(async () => {
                                cacheService.getUser = vi.fn().mockResolvedValueOnce();
                            });

                            it('should return the user', async () => {
                                const user = await authenticationService.authenticate({
                                    phoneNumber,
                                });

                                expect(user).toEqual(user1);
                                expect(cacheService.setUser).not.toHaveBeenCalled();
                                expect(userService.getUserByPhoneNumber).toHaveBeenCalled();
                            });
                        });
                    });
                });
            });

            describe('when no phoneNumber or displayName and membershipType exist', () => {
                it('resolves undefined', async () => {
                    const user = await authenticationService.authenticate();

                    expect(user).toBeUndefined();
                });
            });
        });

        describe('when current user requires a refresh', () => {
            const {
                bungie: { access_token },
            } = mockUser;
            const refreshToken = chance.hash();
            const expiresIn = 1;
            const now = 11;
            let storedUser;

            beforeEach(async () => {
                /**
                 * Built fresh, and carrying a refresh token. mockUser is shared and
                 * this path mutates it in place via `user.bungie = bungie`; it also
                 * models only an access_token, so reusing it here asserted that a
                 * refresh succeeds with no refresh token to send.
                 */
                storedUser = {
                    ...structuredClone(mockUser),
                    bungie: { access_token, refresh_token: refreshToken, _ttl: 0 },
                };
                cacheService.getUser.mockImplementation(() => Promise.resolve(storedUser));
                destinyService.getCurrentUser = vi.fn().mockRejectedValueOnce();
                destinyService.getAccessTokenFromRefreshToken = vi.fn().mockResolvedValue({
                    access_token,
                    expires_in: expiresIn,
                });
            });

            it('refreshes Bungie token', async () => {
                vi.spyOn(Temporal.Now, 'instant').mockReturnValueOnce(
                    Temporal.Instant.fromEpochMilliseconds(now),
                );

                const user = await authenticationService.authenticate({
                    displayName,
                    membershipType,
                });

                expect(user).toEqual({
                    ...storedUser,
                    bungie: {
                        _ttl: now + expiresIn * 1000,
                        access_token,
                        expires_in: expiresIn,
                    },
                });
                expect(destinyService.getAccessTokenFromRefreshToken).toHaveBeenCalledWith(
                    refreshToken,
                );
                expect(userService.updateUserBungie).toHaveBeenCalledOnce();
                expect(cacheService.setUser).toHaveBeenCalledOnce();
            });

            describe('when the stored record carries no refresh token', () => {
                it('fails without calling Bungie', async () => {
                    storedUser.bungie = { access_token, _ttl: 0 };
                    vi.spyOn(Temporal.Now, 'instant').mockReturnValueOnce(
                        Temporal.Instant.fromEpochMilliseconds(now),
                    );

                    await expect(
                        authenticationService.authenticate({ displayName, membershipType }),
                    ).rejects.toThrow(/no refresh_token/);
                    expect(destinyService.getAccessTokenFromRefreshToken).not.toHaveBeenCalled();
                });
            });
        });

        describe('when the stored token is stale but Bungie still accepts it', () => {
            const now = 11;
            const accessToken = chance.hash();
            const currentUser = {
                displayName: chance.word(),
                membershipId: chance.string({ pool: '0123456789' }),
                membershipType: 2,
                profilePicturePath: '/img/profile/avatars/Destiny26.jpg',
            };

            beforeEach(() => {
                // Built fresh rather than reusing mockUser, which earlier tests
                // mutate in place via `user.bungie = bungie`.
                cacheService.getUser.mockImplementation(() =>
                    Promise.resolve({
                        ...structuredClone(mockUser),
                        bungie: { access_token: accessToken, _ttl: 0 },
                    }),
                );
                destinyService.getCurrentUser = vi.fn().mockResolvedValue(currentUser);
                destinyService.getAccessTokenFromRefreshToken = vi.fn();
            });

            /**
             * Pins current behavior rather than endorsing it: revalidating against
             * Bungie replaces the stored document with Bungie's profile, so
             * document-only fields (id, phoneNumber, roles) are dropped from the
             * result and `displayName` comes from Bungie instead. Callers reading
             * `bungie.access_token`, `membershipId`, or `membershipType` are
             * unaffected. See issue #671.
             */
            it('returns the Bungie profile without the document-only fields', async () => {
                vi.spyOn(Temporal.Now, 'instant').mockReturnValueOnce(
                    Temporal.Instant.fromEpochMilliseconds(now),
                );

                const user = await authenticationService.authenticate({
                    displayName,
                    membershipType,
                });

                expect(user).toMatchObject(currentUser);
                expect(user.bungie.access_token).toBe(accessToken);
                expect(user).not.toHaveProperty('phoneNumber');
                expect(user).not.toHaveProperty('roles');
                expect(destinyService.getAccessTokenFromRefreshToken).not.toHaveBeenCalled();
            });
        });
    });
});
