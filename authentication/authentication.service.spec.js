/**
 * Destiny Service Tests
 */
const AuthenticationService = require('./authentication.service'),
	chance = require('chance')(),
	expect = require('chai').expect,
	sinon = require('sinon'),
	[user] = require('../mocks/users.json');

const cacheService = {
	setUser: () => Promise.resolve()
};
const destinyService = {
	getAccessTokenFromRefreshToken: () => Promise.resolve(user.bungie),
	getCurrentUser: () => Promise.resolve(user)
};
const userService = {
	getUserByDisplayName: () => Promise.resolve(user),
	getUserByPhoneNumber: () => Promise.resolve(user),
	updateUserBungie: () => Promise.resolve()
};

let authenticationService;

beforeEach(() => {
	authenticationService = new AuthenticationService({ cacheService, destinyService, userService });
});

describe('AuthenticationService', () => {
	describe('authenticate', () => {
		describe('when displayName and membershipType exist', () => {
			describe('when user exists', () => {
				describe('when token is fresh', () => {
					let spy;
					let stub;

					beforeEach(() => {
						spy = sinon.spy(cacheService, 'setUser');
						stub = sinon.stub(userService, 'getUserByDisplayName');
					});

					it('should cache and return a user', () => {
						const displayName = chance.word();
						const membershipType = 2;
						const user1 = JSON.parse(JSON.stringify(user));

						stub.resolves(user1);

						return authenticationService.authenticate({
							displayName,
							membershipType
						})
							.then(user => {
								expect(user).to.deep.eql(user1);
								expect(spy).to.have.been.calledOnce;
							});
					});

					afterEach(() => {
						spy.restore();
						stub.restore();
					});
				});

				describe('when token is not fresh', () => {
					let rub;
					let spy;
					let stub;

					beforeEach(() => {
						stub = sinon.stub(destinyService, 'getCurrentUser');
						rub = sinon.stub(userService, 'getUserByDisplayName');
						spy = sinon.spy(userService, 'updateUserBungie');
					});

					it('should cache and return a user', () => {
						const displayName = chance.word();
						const membershipType = 2;
						const user1 = JSON.parse(JSON.stringify(user));

						rub.resolves(user1);
						stub.rejects();

						return authenticationService.authenticate({
							displayName,
							membershipType
						})
							.then(user => {
								expect(user).to.deep.eql(user1);
								expect(spy).to.have.been.calledOnce;
							});
					});

					afterEach(() => {
						rub.restore();
						spy.restore();
						stub.restore();
					});
				});
			});

			describe('when user does not exist', () => {
				let stub;

				beforeEach(() => {
					stub = sinon.stub(userService, 'getUserByDisplayName');
				});

				it('should cache and return a user', () => {
					const displayName = chance.word();
					const membershipType = 2;

					stub.resolves();

					return authenticationService.authenticate({
						displayName,
						membershipType
					})
						.catch(err => {
							expect(err).to.not.be.undefined;
						});
				});

				afterEach(() => {
					stub.restore();
				});
			});
		});
	});
});
