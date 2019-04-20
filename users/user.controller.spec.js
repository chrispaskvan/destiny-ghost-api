const UserController = require('./user.controller'),
	chance = require('chance')(),
	httpMocks = require('node-mocks-http');

const displayName = chance.name();
const membershipType = chance.integer({ min: 1, max: 2 });

const destinyService = {
	getCurrentUser: jest.fn()
};
const userService = {
	getUserByDisplayName: jest.fn(),
	updateUser: jest.fn()
};

let userController;

beforeEach(() => {
	userController = new UserController({ destinyService, userService });
});

describe('UserController', () => {
	let res;

	beforeEach(() => {
		res = httpMocks.createResponse({
			eventEmitter: require('events').EventEmitter
		});
	});

	describe('getCurrentUser', () => {
		describe('when session displayName is undefined', () => {
			it('should not return a user', (done) => {
				const req = httpMocks.createRequest({
					session: {
						displayName
					}
				});

				destinyService.getCurrentUser.mockImplementation(() => Promise.reoslve({
					displayName: 'l',
					membershipType: 2,
					links: [
						{
							rel: 'characters',
							href: '/destiny/characters'
						}
					]
				}));
				userService.getUserByDisplayName.mockImplementation(() => Promise.resolve({
					bungie: {
						accessToken: {
							value: '11'
						}
					}
				}));

				res.on('end', () => {
					expect(res.statusCode).toEqual(401);
					done();
				});

				userController.getCurrentUser(req, res);
			});
		});

		describe('when session membershipType is undefined', () => {
			it('should not return a user', (done) => {
				const req = httpMocks.createRequest({
					session: {
						membershipType
					}
				});

				destinyService.getCurrentUser.mockImplementation(() => Promise.resolve({
					displayName: 'l',
					membershipType: 2,
					links: [
						{
							rel: 'characters',
							href: '/destiny/characters'
						}
					]
				}));
				userService.getUserByDisplayName.mockImplementation(() => Promise.resolve({
					bungie: {
						accessToken: {
							value: '11'
						}
					}
				}));

				res.on('end', () => {
					expect(res.statusCode).toEqual(401);
					done();
				});

				userController.getCurrentUser(req, res);
			});
		});

		describe('when session displayName and membershipType are defined', () => {
			describe('when user and destiny services return a user', () => {
				it('should return the current user', (done) => {
					const req = httpMocks.createRequest({
						session: {
							displayName,
							membershipType
						}
					});

					destinyService.getCurrentUser.mockImplementation(() => Promise.resolve({
						displayName: 'l',
						membershipType: 2,
						links: [
							{
								rel: 'characters',
								href: '/destiny/characters'
							}
						]
					}));
					userService.getUserByDisplayName.mockImplementation(() => Promise.resolve({
						bungie: {
							accessToken: {
								value: '11'
							}
						}
					}));

					res.on('end', () => {
						expect(res.statusCode).toEqual(200);
						done();
					});

					userController.getCurrentUser(req, res);
				});
			});

			describe('when destiny service returns undefined', () => {
				it('should not return a user', (done) => {
					const req = httpMocks.createRequest({
						session: {
							displayName,
							membershipType
						}
					});

					destinyService.getCurrentUser.mockImplementation(() => Promise.resolve());
					userService.getUserByDisplayName.mockImplementation(() => Promise.resolve({
						bungie: {
							accessToken: {
								value: '11'
							}
						}
					}));

					res.on('end', () => {
						expect(res.statusCode).toEqual(401);
						done();
					});

					userController.getCurrentUser(req, res);
				});
			});

			describe('when user service returns undefined', () => {
				it('should not return a user', (done) => {
					const req = httpMocks.createRequest({
						session: {
							displayName,
							membershipType
						}
					});

					destinyService.getCurrentUser.mockImplementation(() => Promise.resolve({
						displayName: 'l',
						membershipType: 2,
						links: [
							{
								rel: 'characters',
								href: '/destiny/characters'
							}
						]
					}));
					userService.getUserByDisplayName.mockImplementation(() => Promise.resolve());

					res.on('end', () => {
						expect(res.statusCode).toEqual(401);
						done();
					});

					userController.getCurrentUser(req, res);
				});
			});
		});
	});

	describe('update', () => {
		describe('when user is undefined', () => {
			it('should not return a user', (done) => {
				const req = httpMocks.createRequest({
					session: {}
				});

				userService.getUserByDisplayName.mockImplementation(() => Promise.resolve());

				res.on('end', () => {
					expect(res.statusCode).toEqual(404);
					done();
				});

				userController.update(req, res);
			});
		});

		describe('when user is defined', () => {
			it('should patch the user', (done) => {
				const firstName = '11';
				const req = httpMocks.createRequest({
					body: [
						{
							op: 'replace',
							path: '/firstName',
							value: firstName
						}
					],
					session: {
						displayName,
						membershipType
					}
				});
				const user = {
					displayName,
					firstName: '08',
					membershipType
				};
				const mock = userService.updateUser;

				userService.getUserByDisplayName.mockImplementation(() => Promise.resolve(user));

				res.on('end', () => {
					expect(res.statusCode).toEqual(200);
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
										value: '08'
									}
								],
								version: 1
							}
						]
					});
					done();
				});

				userController.update(req, res);
			});
		});
	});
});
