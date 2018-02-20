const HealthController = require('./health.controller'),
	chai = require('chai'),
	expect = require('chai').expect,
	httpMocks = require('node-mocks-http'),
	{ Response: manifest } = require('../mocks/manifest2Response.json'),
	request = require('request'),
	sinon = require('sinon'),
	sinonChai = require('sinon-chai');

chai.use(sinonChai);

const destinyService = {
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
const worldRepository = {
	close: () => Promise.resolve(),
	getItemByName: () => {},
	open: () => Promise.resolve()
};

let destinyServiceStub;
let documentsStub;
let healthController;
let storeDelStub;
let storeGetStub;
let storeSetStub;
let worlRepositoryStub;

beforeEach(() => {
	healthController = new HealthController({ destinyService, documents, store, worldRepository });
});

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
			it('should return a positive response', (done) => {
				const req = httpMocks.createRequest();

				destinyServiceStub = sinon.stub(destinyService, 'getManifest').resolves(manifest);
				documentsStub = sinon.stub(documents, 'getDocuments').resolves([2]);
				storeDelStub = sinon.stub(store, 'del').yields(undefined, 1);
				storeGetStub = sinon.stub(store, 'get').yields(undefined, 'Thorn');
				storeSetStub = sinon.stub(store, 'set').yields(undefined, 'OK');

				this.request.callsArgWith(1, undefined, { statusCode: 200 }, JSON.stringify({
					status: {
						description: 'All Systems Go'
					}
				}));

				worlRepositoryStub = sinon.stub(worldRepository, 'getItemByName').resolves([{
					displayProperties: {
						description: 'The Number'
					}
				}]);

				res.on('end', () => {
					expect(res.statusCode).to.equal(200);

					const body = JSON.parse(res._getData());
					expect(body).to.deep.equal({
						documents: 2,
						store: true,
						manifest: '61966.18.01.12.0839-8',
						twilio: 'All Systems Go',
						world: 'The Number'
					});

					done();
				});

				healthController.getHealth(req, res);
			});
		});
		describe('when all services are unhealthy', () => {
			it('should return a negative response', (done) => {
				const req = httpMocks.createRequest();

				destinyServiceStub = sinon.stub(destinyService, 'getManifest').rejects();
				documentsStub = sinon.stub(documents, 'getDocuments').rejects();
				storeDelStub = sinon.stub(store, 'del').yields(undefined, 0);
				storeGetStub = sinon.stub(store, 'get').yields(undefined, 'Thorn');
				storeSetStub = sinon.stub(store, 'set').yields(undefined, 'OK');
				this.request.callsArgWith(1, undefined, { statusCode: 400 });
				worlRepositoryStub = sinon.stub(worldRepository, 'getItemByName').rejects();

				res.on('end', () => {
					expect(res.statusCode).to.equal(503);

					const body = JSON.parse(res._getData());
					expect(body).to.deep.equal({
						documents: -1,
						store: false,
						manifest: 'N/A',
						twilio: 'N/A',
						world: 'N/A'
					});

					done();
				});

				healthController.getHealth(req, res);
			});
		});
	});

	afterEach(() => {
		destinyServiceStub.restore();
		documentsStub.restore();
		storeDelStub.restore();
		storeGetStub.restore();
		storeSetStub.restore();
		this.request.restore();
		worlRepositoryStub.restore();
	})
});
