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
	getUserByDisplayName: () => {}
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
							href: '/api/destiny/characters'
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
							href: '/api/destiny/characters'
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
					const req  = httpMocks.createRequest({
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
								href: '/api/destiny/characters'
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
					const req  = httpMocks.createRequest({
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
					const req  = httpMocks.createRequest({
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
								href: '/api/destiny/characters'
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
	});

	afterEach(function () {
		destinyServiceStub.restore();
		userServiceStub.restore();
	})
});
