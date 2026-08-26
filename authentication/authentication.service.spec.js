/**
 * Destiny Service Tests
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Chance from 'chance';
import AuthenticationService, { REVALIDATION_WINDOW_MS } from './authentication.service.js';
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
            /**
             * A genuinely unexpired token. mockUser's bungie carries no `_ttl`,
             * which defaults to 0 and is therefore always stale — so these cases
             * used to run the revalidation path despite their name.
             */
            let freshUser;

            beforeEach(async () => {
                freshUser = {
                    ...structuredClone(mockUser),
                    bungie: { ...mockUser.bungie, _ttl: Number.MAX_SAFE_INTEGER },
                };
                cacheService.getUser.mockImplementation(() => Promise.resolve(freshUser));
                userService.getUserByDisplayName.mockImplementation(() =>
                    Promise.resolve(freshUser),
                );
                userService.getUserByPhoneNumber.mockImplementation(() =>
                    Promise.resolve(freshUser),
                );
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

                            expect(user).toEqual(freshUser);
                            expect(cacheService.setUser).not.toHaveBeenCalled();
                            expect(destinyService.getCurrentUser).not.toHaveBeenCalled();
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

                                expect(user).toEqual(freshUser);
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

                                expect(user).toEqual(freshUser);
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
            /**
             * The full shape DestinyService declares (BungieAccessToken). Stubbing
             * a subset would let the spec pass while fields are dropped on the way
             * to storage — losing refresh_token in particular would break the
             * *next* refresh, not this one.
             */
            const refreshedToken = {
                access_token: chance.hash(),
                expires_in: expiresIn,
                membership_id: chance.string({ pool: '0123456789' }),
                refresh_token: chance.hash(),
            };
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
                destinyService.getAccessTokenFromRefreshToken = vi
                    .fn()
                    .mockResolvedValue(refreshedToken);
            });

            it('refreshes Bungie token', async () => {
                vi.spyOn(Temporal.Now, 'instant').mockReturnValueOnce(
                    Temporal.Instant.fromEpochMilliseconds(now),
                );

                const user = await authenticationService.authenticate({
                    displayName,
                    membershipType,
                });

                const expectedToken = { ...refreshedToken, _ttl: now + expiresIn * 1000 };

                expect(user).toEqual({ ...storedUser, bungie: expectedToken });
                expect(destinyService.getAccessTokenFromRefreshToken).toHaveBeenCalledWith(
                    refreshToken,
                );
                // Every field must survive to storage, not just the new access token.
                expect(userService.updateUserBungie).toHaveBeenCalledWith(
                    storedUser.id,
                    expectedToken,
                );
                expect(cacheService.setUser).toHaveBeenCalledWith(storedUser);
            });

            describe('when the stored record carries no refresh token', () => {
                it('fails without requesting a new token', async () => {
                    storedUser.bungie = { access_token, _ttl: 0 };
                    vi.spyOn(Temporal.Now, 'instant').mockReturnValueOnce(
                        Temporal.Instant.fromEpochMilliseconds(now),
                    );

                    await expect(
                        authenticationService.authenticate({ displayName, membershipType }),
                    ).rejects.toThrow(/Unable to refresh/);
                    expect(destinyService.getAccessTokenFromRefreshToken).not.toHaveBeenCalled();
                });
            });
        });

        describe('when the stored token is stale but Bungie still accepts it', () => {
            const now = 11;
            const accessToken = chance.hash();
            /** The profile is fetched only to test the token, never returned. */
            const currentUser = {
                displayName: chance.word(),
                membershipId: chance.string({ pool: '0123456789' }),
                membershipType: 2,
                profilePicturePath: '/img/profile/avatars/Destiny26.jpg',
            };
            let storedUser;

            beforeEach(() => {
                // Built fresh rather than reusing mockUser, which other tests
                // mutate in place via `user.bungie = bungie`.
                storedUser = {
                    ...structuredClone(mockUser),
                    bungie: { access_token: accessToken, refresh_token: chance.hash(), _ttl: 0 },
                };
                cacheService.getUser.mockImplementation(() => Promise.resolve(storedUser));
                destinyService.getCurrentUser = vi.fn().mockResolvedValue(currentUser);
                destinyService.getAccessTokenFromRefreshToken = vi.fn();
            });

            it('returns the stored document, not the Bungie profile', async () => {
                vi.spyOn(Temporal.Now, 'instant').mockReturnValueOnce(
                    Temporal.Instant.fromEpochMilliseconds(now),
                );

                const user = await authenticationService.authenticate({
                    displayName,
                    membershipType,
                });

                // Document-only fields survive, and displayName stays the stored one.
                expect(user.phoneNumber).toBe(mockUser.phoneNumber);
                expect(user.displayName).toBe(mockUser.displayName);
                expect(user.displayName).not.toBe(currentUser.displayName);
                expect(user.bungie.access_token).toBe(accessToken);
                expect(destinyService.getAccessTokenFromRefreshToken).not.toHaveBeenCalled();
            });

            it('defers the next probe by stamping _ttl', async () => {
                vi.spyOn(Temporal.Now, 'instant').mockReturnValueOnce(
                    Temporal.Instant.fromEpochMilliseconds(now),
                );

                const user = await authenticationService.authenticate({
                    displayName,
                    membershipType,
                });

                expect(user.bungie._ttl).toBe(now + REVALIDATION_WINDOW_MS);
                expect(cacheService.setUser).toHaveBeenCalledWith(user);
            });

            /**
             * Without the stamp above, a record whose token predates `_ttl` would
             * call Bungie on every single request, forever.
             */
            it('does not re-probe Bungie on the next request', async () => {
                vi.spyOn(Temporal.Now, 'instant').mockReturnValue(
                    Temporal.Instant.fromEpochMilliseconds(now),
                );

                await authenticationService.authenticate({ displayName, membershipType });
                expect(destinyService.getCurrentUser).toHaveBeenCalledOnce();

                await authenticationService.authenticate({ displayName, membershipType });
                expect(destinyService.getCurrentUser).toHaveBeenCalledOnce();
            });

            it('still authenticates when caching the revalidated user fails', async () => {
                cacheService.setUser.mockRejectedValueOnce(new Error('redis is down'));
                vi.spyOn(Temporal.Now, 'instant').mockReturnValueOnce(
                    Temporal.Instant.fromEpochMilliseconds(now),
                );

                const user = await authenticationService.authenticate({
                    displayName,
                    membershipType,
                });

                expect(user.phoneNumber).toBe(mockUser.phoneNumber);
            });
        });
    });
});
