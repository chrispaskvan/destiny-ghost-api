/**
 * Destiny Service Tests
 */
const AuthenticationService = require('./authentication.service'),
	chance = require('chance')(),
	{ cloneDeep } = require('lodash'),
	[user] = require('../mocks/users.json');

const cacheService = {
	setUser: jest.fn().mockResolvedValue()
};
const destinyService = {
	getAccessTokenFromRefreshToken: jest.fn(),
	getCurrentUser: jest.fn()
};
const userService = {
	getUserByDisplayName: jest.fn(),
	getUserByPhoneNumber: jest.fn(),
	updateUserBungie: jest.fn()
};

let authenticationService;

beforeEach(() => {
	authenticationService = new AuthenticationService({ cacheService, destinyService, userService });
});

const user1 = cloneDeep(user);

describe('AuthenticationService', () => {
	describe('constructor', () => {
		it('required dependencies are injected', () => {
			const options = {
				cacheService: {},
				destinyService: {},
				userService: {}
			};
			const authenticationService = new AuthenticationService(options);

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
				destinyService.getCurrentUser = jest.fn().mockResolvedValue(user);
			});

			describe('when displayName and membershipType exist', () => {
				describe('when user exists', () => {
					describe('when token is fresh', () => {
						beforeEach(async () => {
							userService.getCurrentUser = jest.fn().mockResolvedValue(user);
							userService.getUserByDisplayName = jest.fn().mockResolvedValue(user);
						});

						it('should cache and return a user', async () => {
							const user = await authenticationService.authenticate({
								displayName,
								membershipType
							});

							expect(user).toEqual(user1);
							expect(cacheService.setUser).toHaveBeenCalledOnce;
						});
					});

					describe('when token is not fresh', () => {
						beforeEach(async () => {
							userService.getCurrentUser = jest.fn().mockRejectedValue();
							userService.getUserByDisplayName = jest.fn().mockResolvedValue(user);
						});

						it('should cache and return a user', async () => {
							const user = await authenticationService.authenticate({
								displayName,
								membershipType
							});

							expect(user).toEqual(user1);
							expect(userService.updateUserBungie).toHaveBeenCalledOnce;
						});
					});
				});

				describe('when user does not exist', () => {
					beforeEach(async () => {
						userService.getUserByDisplayName = jest.fn().mockResolvedValue();
					});

					it('should cache and return a user', async () => {
						const user = await authenticationService.authenticate({
							displayName,
							membershipType
						});

						expect(user).toBeUndefined;
					});
				});
			});

			describe('when displayName and membershipType do not exist', () => {
				const phoneNumber = chance.phone();

				describe('when user exists', () => {
					beforeEach(async () => {
						userService.getCurrentUser = jest.fn().mockResolvedValue(user);
						userService.getUserByPhoneNumber = jest.fn().mockResolvedValue(user);
					});

					describe('when token is fresh', () => {
						it('should cache and return a user', async () => {
							const user = await authenticationService.authenticate({
								phoneNumber
							});

							expect(user).toEqual(user1);
							expect(cacheService.getUserByPhoneNumber).toHaveBeenCalledOnce;
						});
					});
				});

				describe('when user does not exist', () => {
					beforeEach(async () => {
						userService.getUserByDisplayName = jest.fn().mockResolvedValue();
					});

					it('should cache and return a user', async () => {
						try {
							await authenticationService.authenticate({
								displayName,
								membershipType
							});
						} catch (err) {
							expect(err).not.toBeUndefined;
						}
					});
				});
			});

			describe('when no phoneNumber or displayName and membershipType exist', () => {
				it('resolves undefined', async () => {
					const user = await authenticationService.authenticate();

					expect(user).toBeUndefined;
				});
			});
		});

		describe('when current user requires a refresh', () => {
			const { bungie: { access_token }} = user;

			beforeEach(async () => {
				destinyService.getCurrentUser = jest.fn().mockRejectedValue();
				destinyService.getAccessTokenFromRefreshToken = jest.fn().mockResolvedValue({ access_token });
				userService.getCurrentUser = jest.fn().mockResolvedValue(user);
				userService.getUserByDisplayName = jest.fn().mockResolvedValue(user);
			});

			it('refreshes Bungie token', async () => {
				const user = await authenticationService.authenticate({
					displayName,
					membershipType
				});

				expect(user).toEqual(user1);
			});
		});
	});
});
