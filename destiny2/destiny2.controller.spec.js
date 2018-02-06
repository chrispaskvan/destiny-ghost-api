const Destiny2Controller = require('./destiny2.controller'),
	chai = require('chai'),
	chance = require('chance')(),
	expect = require('chai').expect,
	httpMocks = require('node-mocks-http'),
	{ Response: manifest } = require('../mocks/manifest2Response.json'),
	sinon = require('sinon'),
	sinonChai = require('sinon-chai');

chai.use(sinonChai);

const destiny2Service = {
	getManifest: () => Promise.resolve(manifest),
	getProfile: () => Promise.resolve()
};
const displayName = chance.name();
const membershipType = chance.integer({ min: 1, max: 2 });
const userService = {
	getUserByDisplayName: () => Promise.resolve()
};

let destiny2ServiceStub;
let destiny2Controller;
let userServiceStub;

beforeEach(function () {
	const worldRepository = {
		close: () => Promise.resolve(),
		getClassByHash: () => Promise.resolve({
			classType: 1,
			displayProperties: {
				name: 'Hunter',
				hasIcon: false
			},
			genderedClassNames: {
				Male: 'Hunter',
				Female: 'Hunter'
			},
			hash: 671679327,
			index: 1,
			redacted: false
		}),
		open: () => Promise.resolve()
	};

	destiny2Controller = new Destiny2Controller({ destinyService: destiny2Service, userService, worldRepository });
});

describe('Destiny2Controller', () => {
	let res;

	beforeEach(function () {
		res = httpMocks.createResponse({
			eventEmitter: require('events').EventEmitter
		});
	});

	describe('getProfile', () => {
		describe('when session displayName and membershipType are defined', function () {
			describe('when user and destiny services return a user', function () {
				it('should return user profile', function (done) {
					const req = httpMocks.createRequest({
						session: {
							displayName,
							membershipType
						}
					});

					destiny2ServiceStub = sinon.stub(destiny2Service, 'getProfile').resolves([
						{
							characterId: '1111111111111111111',
							classHash: 671679327,
							light: 284,
							links: [
								{
									rel: 'Character',
									href: '/characters/1111111111111111111'
								}
							]
						}
					]);

					userServiceStub = sinon.stub(userService, 'getUserByDisplayName').resolves({
						membershipId: '1'
					});

					res.on('end', () => {
						const data = JSON.parse(res._getData());

						try {
							expect(res.statusCode).to.equal(200);
							expect(data[0].className).to.equal('Hunter');
							done();
						} catch (err) {
							done(err);
						}
					});

					destiny2Controller.getProfile(req, res);
				});
			});
		});
	});

	afterEach(function () {
		destiny2ServiceStub.restore();
		userServiceStub.restore();
	})
});
