/**
 * Destiny Service Tests
 */
const Chance = require('chance');
const { cloneDeep } = require('lodash');

const AuthenticationService = require('./authentication.service');
const [mockUser] = require('../mocks/users.json');

const cacheService = {
    setUser: jest.fn().mockResolvedValue(),
};
const chance = new Chance();
const destinyService = {
    getAccessTokenFromRefreshToken: jest.fn(),
    getCurrentUser: jest.fn(),
};
const userService = {
    getUserByDisplayName: jest.fn(),
    getUserByPhoneNumber: jest.fn(),
    updateUserBungie: jest.fn(),
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

        describe('when current user is fresh', () => {
            beforeEach(async () => {
                destinyService.getCurrentUser = jest.fn().mockResolvedValue(mockUser);
            });

            describe('when displayName and membershipType exist', () => {
                describe('when user exists', () => {
                    describe('when token is fresh', () => {
                        beforeEach(async () => {
                            userService.getCurrentUser = jest.fn().mockResolvedValue(mockUser);
                            userService.getUserByDisplayName = jest.fn()
                                .mockResolvedValue(mockUser);
                        });

                        it('should cache and return a user', async () => {
                            const user = await authenticationService.authenticate({
                                displayName,
                                membershipType,
                            });

                            expect(user).toEqual(user1);
                            // eslint-disable-next-line jest/valid-expect, no-unused-expressions
                            expect(cacheService.setUser).toHaveBeenCalledOnce;
                        });
                    });

                    describe('when token is not fresh', () => {
                        beforeEach(async () => {
                            userService.getCurrentUser = jest.fn().mockRejectedValue();
                            userService.getUserByDisplayName = jest.fn()
                                .mockResolvedValue(mockUser);
                        });

                        it('should cache and return a user', async () => {
                            const user = await authenticationService.authenticate({
                                displayName,
                                membershipType,
                            });

                            expect(user).toEqual(user1);
                            // eslint-disable-next-line no-unused-expressions, jest/valid-expect
                            expect(userService.updateUserBungie).toHaveBeenCalledOnce;
                        });
                    });
                });

                describe('when user does not exist', () => {
                    beforeEach(async () => {
                        userService.getUserByDisplayName = jest.fn().mockResolvedValue();
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
                    beforeEach(async () => {
                        userService.getCurrentUser = jest.fn().mockResolvedValue(mockUser);
                        userService.getUserByPhoneNumber = jest.fn().mockResolvedValue(mockUser);
                    });

                    describe('when token is fresh', () => {
                        it('should cache and return a user', async () => {
                            const user = await authenticationService.authenticate({
                                phoneNumber,
                            });

                            expect(user).toEqual(user1);
                            // eslint-disable-next-line jest/valid-expect, no-unused-expressions
                            expect(cacheService.getUserByPhoneNumber).toHaveBeenCalledOnce;
                        });
                    });
                });

                describe('when user does not exist', () => {
                    beforeEach(async () => {
                        userService.getUserByDisplayName = jest.fn().mockResolvedValue();
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

            beforeEach(async () => {
                destinyService.getCurrentUser = jest.fn().mockRejectedValue();
                destinyService.getAccessTokenFromRefreshToken = jest.fn().mockResolvedValue({
                    access_token,
                });
                userService.getCurrentUser = jest.fn().mockResolvedValue(mockUser);
                userService.getUserByDisplayName = jest.fn().mockResolvedValue(mockUser);
            });

            it('refreshes Bungie token', async () => {
                const user = await authenticationService.authenticate({
                    displayName,
                    membershipType,
                });

                expect(user).toEqual(user1);
            });
        });
    });
});
