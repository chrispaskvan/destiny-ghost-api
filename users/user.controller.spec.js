const UserController = require('./user.controller'),
	chai = require('chai'),
	chance = require('chance')(),
	expect = require('chai').expect,
	httpMocks = require('node-mocks-http'),
	sinon = require('sinon'),
	sinonChai = require('sinon-chai');

chai.use(sinonChai);

const destinyService = {
	getCurrentUser: () => {}
};
const displayName = chance.name();
const membershipType = chance.integer({ min: 1, max: 2 });
const userService = {
	getUserByDisplayName: () => {},
	updateUser: () => {}
};

let destinyServiceStub;
let userController;
let userServiceStub;

beforeEach(function () {
	userController = new UserController({ destinyService, userService });
});

describe('UserController', () => {
	let res;

	beforeEach(function () {
		res = httpMocks.createResponse({
			eventEmitter: require('events').EventEmitter
		});
	});

	describe('getCurrentUser', () => {
		describe('when session displayName is undefined', function () {
			it('should not return a user', function (done) {
				const req = httpMocks.createRequest({
					session: {
						displayName
					}
				});

				destinyServiceStub = sinon.stub(destinyService, 'getCurrentUser').resolves({
					displayName: 'l',
					membershipType: 2,
					links: [
						{
							rel: 'characters',
							href: '/destiny/characters'
						}
					]
				});
				userServiceStub = sinon.stub(userService, 'getUserByDisplayName').resolves({
					bungie: {
						accessToken: {
							value: '11'
						}
					}
				});

				res.on('end', function () {
					expect(res.statusCode).to.equal(401);
					done();
				});

				userController.getCurrentUser(req, res);
			});
		});

		describe('when session membershipType is undefined', function () {
			it('should not return a user', function (done) {
				const req = httpMocks.createRequest({
					session: {
						membershipType
					}
				});

				destinyServiceStub = sinon.stub(destinyService, 'getCurrentUser').resolves({
					displayName: 'l',
					membershipType: 2,
					links: [
						{
							rel: 'characters',
							href: '/destiny/characters'
						}
					]
				});
				userServiceStub = sinon.stub(userService, 'getUserByDisplayName').resolves({
					bungie: {
						accessToken: {
							value: '11'
						}
					}
				});

				res.on('end', function () {
					expect(res.statusCode).to.equal(401);
					done();
				});

				userController.getCurrentUser(req, res);
			});
		});

		describe('when session displayName and membershipType are defined', function () {
			describe('when user and destiny services return a user', function () {
				it('should return the current user', function (done) {
					const req = httpMocks.createRequest({
						session: {
							displayName,
							membershipType
						}
					});

					destinyServiceStub = sinon.stub(destinyService, 'getCurrentUser').resolves({
						displayName: 'l',
						membershipType: 2,
						links: [
							{
								rel: 'characters',
								href: '/destiny/characters'
							}
						]
					});
					userServiceStub = sinon.stub(userService, 'getUserByDisplayName').resolves({
						bungie: {
							accessToken: {
								value: '11'
							}
						}
					});

					res.on('end', function() {
						expect(res.statusCode).to.equal(200);
						done();
					});

					userController.getCurrentUser(req, res);
				});
			});

			describe('when destiny service returns undefined', function () {
				it('should not return a user', function (done) {
					const req = httpMocks.createRequest({
						session: {
							displayName,
							membershipType
						}
					});

					destinyServiceStub = sinon.stub(destinyService, 'getCurrentUser').resolves();
					userServiceStub = sinon.stub(userService, 'getUserByDisplayName').resolves({
						bungie: {
							accessToken: {
								value: '11'
							}
						}
					});

					res.on('end', function() {
						expect(res.statusCode).to.equal(401);
						done();
					});

					userController.getCurrentUser(req, res);
				});
			});

			describe('when user service returns undefined', function () {
				it('should not return a user', function (done) {
					const req = httpMocks.createRequest({
						session: {
							displayName,
							membershipType
						}
					});

					destinyServiceStub = sinon.stub(destinyService, 'getCurrentUser').resolves({
						displayName: 'l',
						membershipType: 2,
						links: [
							{
								rel: 'characters',
								href: '/destiny/characters'
							}
						]
					});
					userServiceStub = sinon.stub(userService, 'getUserByDisplayName').resolves();

					res.on('end', function() {
						expect(res.statusCode).to.equal(401);
						done();
					});

					userController.getCurrentUser(req, res);
				});
			});
		});

		afterEach(function () {
			destinyServiceStub.restore();
			userServiceStub.restore();
		})
	});

	describe('update', () => {
		describe('when user is undefined', function () {
			it('should not return a user', function (done) {
				const req = httpMocks.createRequest({
					session: {}
				});

				userServiceStub = sinon.stub(userService, 'getUserByDisplayName').resolves();

				res.on('end', function () {
					expect(res.statusCode).to.equal(404);
					done();
				});

				userController.update(req, res);
			});
		});

		describe('when user is defined', function () {
			it('should patch the user', function (done) {
				const firstName = '11';
				const mock = sinon.mock(userService);
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

				userServiceStub = sinon.stub(userService, 'getUserByDisplayName').resolves(user);
				mock.expects('updateUser').once().withArgs({
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
				}).resolves();

				res.on('end', function() {
					expect(res.statusCode).to.equal(200);
					mock.verify();
					mock.restore();
					done();
				});

				userController.update(req, res);
			});
		});

		afterEach(function () {
			userServiceStub.restore();
		})
	});
});
