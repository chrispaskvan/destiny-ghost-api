/**
 * Destiny Service Tests
 */
import {
    beforeEach, describe, expect, it, vi,
} from 'vitest';
import Chance from 'chance';
import cloneDeep from 'lodash/cloneDeep';
import AuthenticationService from './authentication.service';
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

const user1 = cloneDeep(mockUser);

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
            // eslint-disable-next-line camelcase
            const { bungie: { access_token } } = mockUser;
            const expiresIn = 1;
            const now = 11;

            beforeEach(async () => {
                destinyService.getCurrentUser = vi.fn().mockRejectedValueOnce();
                destinyService.getAccessTokenFromRefreshToken = vi.fn().mockResolvedValue({
                    access_token, // eslint-disable-line camelcase
                    expires_in: expiresIn,
                });
            });

            it('refreshes Bungie token', async () => {
                vi.spyOn(global.Date, 'now')
                    .mockImplementationOnce(() => now);

                const user = await authenticationService.authenticate({
                    displayName,
                    membershipType,
                });

                expect(user).toEqual({
                    ...user1,
                    bungie: {
                        _ttl: now + expiresIn * 1000,
                        access_token, // eslint-disable-line camelcase
                        expires_in: expiresIn,
                    },
                });
                expect(userService.updateUserBungie).toHaveBeenCalledOnce();
                expect(cacheService.setUser).toHaveBeenCalledOnce();
            });
        });
    });
});
