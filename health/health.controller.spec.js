const HealthController = require('../health/health.controller'),
	chai = require('chai'),
	expect = require('chai').expect,
	httpMocks = require('node-mocks-http'),
	{ Response: manifest } = require('../mocks/manifestResponse.json'),
	{ Response: manifest2 } = require('../mocks/manifest2Response.json'),
	request = require('request'),
	sinon = require('sinon'),
	sinonChai = require('sinon-chai');

chai.use(sinonChai);

const destinyService = {
	getManifest: () => {}
};
const destiny2Service = {
	getManifest: () => {}
};
const documents = {
	getDocuments: () => {}
};
const store = {
	del: () => {},
	get: () => {},
	set: () => {}
};

let destinyServiceStub;
let destiny2ServiceStub;
let documentsStub;
let healthController;
let storeDelStub;
let storeGetStub;
let storeSetStub;

describe('HealthController', () => {
	let res;

	beforeEach(() => {
		res = httpMocks.createResponse({
			eventEmitter: require('events').EventEmitter
		});
		this.request = sinon.stub(request, 'get');
	});

	describe('getHealth', () => {
		describe('when all services are healthy', () => {
			const world = {
				getItemByName: () => Promise.resolve([{
					itemDescription: 'Red Hand IX'
				}])
			};
			const world2 = {
				getItemByName: () => Promise.resolve([{
					displayProperties: {
						description: 'The Number'
					}
				}])
			};

			beforeEach(() => {
				healthController = new HealthController({ destinyService, destiny2Service, documents, store, worldRepository: world, world2Repository: world2 });
			});

			it('should return a positive response', (done) => {
				const req = httpMocks.createRequest();

				destinyServiceStub = sinon.stub(destinyService, 'getManifest').resolves(manifest);
				destiny2ServiceStub = sinon.stub(destiny2Service, 'getManifest').resolves(manifest2);
				documentsStub = sinon.stub(documents, 'getDocuments').resolves([2]);
				storeDelStub = sinon.stub(store, 'del').yields(undefined, 1);
				storeGetStub = sinon.stub(store, 'get').yields(undefined, 'Thorn');
				storeSetStub = sinon.stub(store, 'set').yields(undefined, 'OK');

				this.request.callsArgWith(1, undefined, { statusCode: 200 }, JSON.stringify({
					status: {
						description: 'All Systems Go'
					}
				}));

				res.on('end', () => {
					expect(res.statusCode).to.equal(200);

					const body = JSON.parse(res._getData());

					expect(body).to.deep.equal({
						documents: 2,
						store: true,
						twilio: 'All Systems Go',
						destiny: {
							manifest: '56578.17.04.12.1251-6',
							world: 'Red Hand IX'
						},
						destiny2: {
							manifest: '61966.18.01.12.0839-8',
							world: 'The Number'
						}
					});

					done();
				});

				healthController.getHealth(req, res);
			});
		});

		describe('when all services are unhealthy', () => {
			const world = {
				close: () => Promise.resolve(),
				getItemByName: () => Promise.reject(),
				open: () => Promise.resolve()
			};
			const world2 = {
				close: () => Promise.resolve(),
				getItemByName: () => Promise.reject(),
				open: () => Promise.resolve()
			};

			beforeEach(() => {
				healthController = new HealthController({ destinyService, destiny2Service, documents, store, worldRepository: world, world2Repository: world2 });
			});

			it('should return a negative response', (done) => {
				const req = httpMocks.createRequest();

				destinyServiceStub = sinon.stub(destinyService, 'getManifest').rejects();
				destinyServiceStub = sinon.stub(destiny2Service, 'getManifest').rejects();
				documentsStub = sinon.stub(documents, 'getDocuments').rejects();
				storeDelStub = sinon.stub(store, 'del').yields(undefined, 0);
				storeGetStub = sinon.stub(store, 'get').yields(undefined, 'Thorn');
				storeSetStub = sinon.stub(store, 'set').yields(undefined, 'OK');
				this.request.callsArgWith(1, undefined, { statusCode: 400 });

				res.on('end', () => {
					expect(res.statusCode).to.equal(503);

					const body = JSON.parse(res._getData());
					expect(body).to.deep.equal({
						documents: -1,
						store: false,
						twilio: 'N/A',
						destiny: {
							manifest: 'N/A',
							world: 'N/A'
						},
						destiny2: {
							manifest: 'N/A',
							world: 'N/A'
						}
					});

					done();
				});

				healthController.getHealth(req, res);
			});
		});
	});

	afterEach(() => {
		destinyServiceStub.restore();
		destiny2ServiceStub.restore();
		documentsStub.restore();
		storeDelStub.restore();
		storeGetStub.restore();
		storeSetStub.restore();

		this.request.restore();
	})
});
