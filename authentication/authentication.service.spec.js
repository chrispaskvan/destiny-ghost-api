/**
 * Destiny Service Tests
 */
const AuthenticationService = require('./authentication.service'),
	chance = require('chance')(),
	expect = require('chai').expect,
	sinon = require('sinon'),
	[user] = require('../mocks/users.json');

const cacheService = {
	setUser: function() {
		return Promise.resolve();
	}
};
const destinyService = {
	getAccessTokenFromRefreshToken: function () {
		return Promise.resolve(user.bungie);
	},
	getCurrentUser: function () {
		return Promise.resolve(user);
	}
};
const userService = {
	getUserByDisplayName: function () {
		return Promise.resolve(user);
	},
	getUserByPhoneNumber: function () {
		return Promise.resolve(user);
	},
	updateAnonymousUser: function () {
		return Promise.resolve();
	},
	updateUserBungie: function () {
		return Promise.resolve();
	}
};

let authenticationService;

beforeEach(function () {
	authenticationService = new AuthenticationService({ cacheService, destinyService, userService });
});

describe('AuthenticationService', function () {
	describe('authenticate', function () {
		describe('when displayName and membershipType exist', function () {
			describe('when user exists', function () {
				describe('when token is fresh', function () {
					let spy;

					beforeEach(function () {
						spy = sinon.spy(cacheService, 'setUser');
					});

					describe('when user is registered', function () {
						let stub;

						beforeEach(function () {
							stub = sinon.stub(userService, 'getUserByDisplayName');
						});

						it('should cache and return a user', function () {
							const displayName = chance.word();
							const membershipType = 2;
							const user1 = JSON.parse(JSON.stringify(user));

							stub.resolves(Object.assign(user1, {
								dateRegistered: '2017-07-08T00:46:13.705Z'
							}));

							return authenticationService.authenticate({
								displayName,
								membershipType
							})
								.then(function (user) {
									expect(user).to.deep.eql(user1);
									expect(spy).to.have.been.calledOnce;
								});
						});

						afterEach(function () {
							stub.restore();
						});
					});

					describe('when user is not registered', function () {
						it('should return a user', function () {
							const displayName = chance.word();
							const membershipType = 2;

							return authenticationService.authenticate({
								displayName,
								membershipType
							})
								.then(function (user1) {
									expect(user1).to.deep.eql(user);
									expect(spy).to.have.not.been.called;
								});
						});
					});

					afterEach(function () {
						spy.restore();
					});
				});

				describe('when token is not fresh', function () {
					let stub;

					beforeEach(function () {
						stub = sinon.stub(destinyService, 'getCurrentUser');
					});

					describe('when user is registered', function () {
						let rub;
						let spy;

						beforeEach(function () {
							rub = sinon.stub(userService, 'getUserByDisplayName');
							spy = sinon.spy(userService, 'updateUserBungie');
						});

						it('should cache and return a user', function () {
							const displayName = chance.word();
							const membershipType = 2;
							const user1 = JSON.parse(JSON.stringify(user));

							rub.resolves(Object.assign(user1, {
								dateRegistered: '2017-07-08T00:46:13.705Z'
							}));
							stub.rejects();

							return authenticationService.authenticate({
								displayName,
								membershipType
							})
								.then(function (user) {
									expect(user).to.deep.eql(user1);
									expect(spy).to.have.been.calledOnce;
								});
						});

						afterEach(function () {
							rub.restore();
							spy.restore();
						});
					});

					describe('when user is not registered', function () {
						let spy;

						beforeEach(function () {
							spy = sinon.spy(userService, 'updateAnonymousUser');
						});

						it('should return a user', function () {
							const displayName = chance.word();
							const membershipType = 2;

							stub.rejects();

							return authenticationService.authenticate({
								displayName,
								membershipType
							})
								.then(function (user1) {
									expect(user1).to.deep.eql(user);
									expect(spy).to.have.been.called;
								});
						});

						afterEach(function () {
							spy.restore();
						});
					});

					afterEach(function () {
						stub.restore();
					});
				});
			});

			describe('when user does not exist', function () {
				let stub;

				beforeEach(function () {
					stub = sinon.stub(userService, 'getUserByDisplayName');
				});

				it('should cache and return a user', function () {
					const displayName = chance.word();
					const membershipType = 2;

					stub.resolves();

					return authenticationService.authenticate({
						displayName,
						membershipType
					})
						.catch(function (err) {
							expect(err).to.not.be.undefined;
						});
				});

				afterEach(function () {
					stub.restore();
				});
			});
		});
	});
});
