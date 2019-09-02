const { EventEmitter } = require('events');
const httpMocks = require('node-mocks-http');
const request = require('../helpers/request');
const HealthController = require('../health/health.controller');
const { Response: manifest } = require('../mocks/manifestResponse.json');
const { Response: manifest2 } = require('../mocks/manifest2Response.json');

jest.mock('../helpers/request');

const destinyService = {
    getManifest: jest.fn(),
};
const destiny2Service = {
    getManifest: jest.fn(),
};
const documents = {
    getDocuments: jest.fn(),
};
const store = {
    del: jest.fn(),
    get: jest.fn(),
    set: jest.fn(),
};

let healthController;

describe('HealthController', () => {
    let res;

    beforeEach(() => {
        res = httpMocks.createResponse({
            eventEmitter: EventEmitter,
        });
    });

    describe('getHealth', () => {
        describe('when all services are healthy', () => {
            const world = {
                getItemByName: () => Promise.resolve([{
                    itemDescription: 'Red Hand IX',
                }]),
            };
            const world2 = {
                getItemByName: () => Promise.resolve([{
                    displayProperties: {
                        description: 'The Number',
                    },
                }]),
            };

            beforeEach(() => {
                request.get.mockImplementation(() => Promise.resolve({
                    status: {
                        description: 'All Systems Go',
                    },
                }));

                healthController = new HealthController({
                    destinyService,
                    destiny2Service,
                    documents,
                    store,
                    worldRepository: world,
                    world2Repository: world2,
                });
            });

            it('should return a positive response', done => {
                const req = httpMocks.createRequest();

                destinyService.getManifest = jest.fn().mockResolvedValue(manifest);
                destiny2Service.getManifest = jest.fn().mockResolvedValue(manifest2);
                documents.getDocuments = jest.fn().mockResolvedValue([2]);
                store.del = jest.fn().mockImplementation((key, callback) => callback(undefined, 1));
                store.get = jest.fn().mockImplementation((key, callback) => callback(undefined, 'Thorn'));
                store.set = jest.fn().mockImplementation((key, value, callback) => callback(undefined, 'OK'));

                res.on('end', () => {
                    expect(res.statusCode).toEqual(200);

                    const body = JSON.parse(res._getData()); // eslint-disable-line max-len, no-underscore-dangle

                    expect(body).toEqual({
                        documents: 2,
                        twilio: 'All Systems Go',
                        destiny: {
                            manifest: '56578.17.04.12.1251-6',
                            world: 'Red Hand IX',
                        },
                        destiny2: {
                            manifest: '61966.18.01.12.0839-8',
                            world: 'The Number',
                        },
                    });

                    done();
                });

                healthController.getHealth(req, res);
            });
        });

        describe('when all services are unhealthy', () => {
            const world = {
                close: () => Promise.resolve(),
                getItemByName: () => Promise.reject(new Error()),
                open: () => Promise.resolve(),
            };
            const world2 = {
                close: () => Promise.resolve(),
                getItemByName: () => Promise.reject(new Error()),
                open: () => Promise.resolve(),
            };

            beforeEach(() => {
                request.get.mockImplementation(() => Promise.rejects({
                    statusCode: 400,
                }));

                healthController = new HealthController({
                    destinyService,
                    destiny2Service,
                    documents,
                    store,
                    worldRepository: world,
                    world2Repository: world2,
                });
            });

            it('should return a negative response', done => {
                const req = httpMocks.createRequest();

                destinyService.getManifest = jest.fn().mockRejectedValue(new Error());
                destiny2Service.getManifest = jest.fn().mockRejectedValue(new Error());
                documents.getDocuments = jest.fn().mockRejectedValue(new Error());
                store.del = jest.fn().mockImplementation((key, callback) => callback(undefined, 0));
                store.get = jest.fn().mockImplementation((key, callback) => callback(undefined, 'Thorn'));
                store.set = jest.fn().mockImplementation((key, value, callback) => callback(undefined, 'OK'));

                res.on('end', () => {
                    expect(res.statusCode).toEqual(503);

                    const body = JSON.parse(res._getData()); // eslint-disable-line max-len, no-underscore-dangle
                    expect(body).toEqual({
                        documents: -1,
                        twilio: 'N/A',
                        destiny: {
                            manifest: 'N/A',
                            world: 'N/A',
                        },
                        destiny2: {
                            manifest: 'N/A',
                            world: 'N/A',
                        },
                    });

                    done();
                });

                healthController.getHealth(req, res);
            });
        });
    });
});
