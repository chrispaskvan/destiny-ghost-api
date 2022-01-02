const { EventEmitter } = require('events');
const HttpStatus = require('http-status-codes');
const httpMocks = require('node-mocks-http');
const request = require('../helpers/request');
const HealthRouter = require('./health.routes');
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

let healthRouter;

describe('HealthRouter', () => {
    let res;

    beforeEach(() => {
        res = httpMocks.createResponse({
            eventEmitter: EventEmitter,
        });
    });

    describe('getHealth', () => {
        describe('when all services are healthy', () => {
            const world = {
                getGrimoireCards: () => Promise.resolve([{
                    cardName: 'Red Hand IX',
                }]),
            };
            const world2 = {
                getItemByName: () => Promise.resolve([{
                    itemName: 'Eyasluna',
                    itemTypeAndTierDisplayName: 'Legendary Hand Cannon',
                }]),
            };

            beforeEach(() => {
                request.get.mockImplementation(() => Promise.resolve({
                    status: {
                        description: 'All Systems Go',
                    },
                }));

                healthRouter = HealthRouter({
                    destinyService,
                    destiny2Service,
                    documents,
                    worldRepository: world,
                    world2Repository: world2,
                });
            });

            it('should return a positive response', () => new Promise((done, reject) => {
                const req = httpMocks.createRequest({
                    method: 'GET',
                    url: '/',
                });

                destinyService.getManifest = jest.fn().mockResolvedValue(manifest);
                destiny2Service.getManifest = jest.fn().mockResolvedValue(manifest2);
                documents.getDocuments = jest.fn().mockResolvedValue([2]);

                res.on('end', () => {
                    try {
                        expect(res.statusCode).toEqual(HttpStatus.OK);

                        // eslint-disable-next-line no-underscore-dangle
                        const body = JSON.parse(res._getData());

                        expect(body).toEqual({
                            documents: 2,
                            twilio: 'All Systems Go',
                            destiny: {
                                manifest: '56578.17.04.12.1251-6',
                                world: 'Red Hand IX',
                            },
                            destiny2: {
                                manifest: '61966.18.01.12.0839-8',
                                world: 'Eyasluna Legendary Hand Cannon',
                            },
                        });

                        done();
                    } catch (err) {
                        reject(err);
                    }
                });

                healthRouter(req, res);
            }));
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
                    statusCode: HttpStatus.BAD_REQUEST,
                }));

                healthRouter = HealthRouter({
                    destinyService,
                    destiny2Service,
                    documents,
                    worldRepository: world,
                    world2Repository: world2,
                });
            });

            it('should return a negative response', () => new Promise((done, reject) => {
                const req = httpMocks.createRequest({
                    method: 'GET',
                    url: '/',
                });

                destinyService.getManifest = jest.fn().mockRejectedValue(new Error());
                destiny2Service.getManifest = jest.fn().mockRejectedValue(new Error());
                documents.getDocuments = jest.fn().mockRejectedValue(new Error());

                res.on('end', () => {
                    try {
                        expect(res.statusCode).toEqual(HttpStatus.SERVICE_UNAVAILABLE);

                        // eslint-disable-next-line no-underscore-dangle
                        const body = JSON.parse(res._getData());
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
                    } catch (err) {
                        reject(err);
                    }
                });

                healthRouter(req, res);
            }));
        });
    });

    describe('liveness', () => {
        it('should return up', () => new Promise((done, reject) => {
            const req = httpMocks.createRequest({
                method: 'GET',
                url: '/live',
            });

            res.on('end', () => {
                try {
                    expect(res.statusCode).toEqual(HttpStatus.OK);

                    // eslint-disable-next-line no-underscore-dangle
                    const body = JSON.parse(res._getData());

                    expect(body).toEqual({
                        status: 'UP',
                        checks: [
                            {
                                name: 'liveliness',
                                state: 'UP',
                            },
                        ],
                    });

                    done();
                } catch (err) {
                    reject(err);
                }
            });

            healthRouter(req, res);
        }));
    });
});
