const request = require('../helpers/request');
const HealthController = require('./health.controller');
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
    describe('getHealth', () => {
        describe('when all services are healthy', () => {
            const world = {
                getGrimoireCards: () => Promise.resolve([{
                    cardDescription: 'Red Hand IX',
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

            it('should return a positive response', async () => {
                destinyService.getManifest = jest.fn().mockResolvedValue(manifest);
                destiny2Service.getManifest = jest.fn().mockResolvedValue(manifest2);
                documents.getDocuments = jest.fn().mockResolvedValue([2]);
                store.del = jest.fn().mockImplementation((key, callback) => callback(undefined, 1));
                store.get = jest.fn().mockImplementation((key, callback) => callback(undefined, 'Thorn'));
                store.set = jest.fn().mockImplementation((key, value, callback) => callback(undefined, 'OK'));

                const { failures, health } = await healthController.getHealth();

                expect(failures).toEqual(0);
                expect(health).toEqual({
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

            it('should return a negative response', async () => {
                destinyService.getManifest = jest.fn().mockRejectedValue(new Error());
                destiny2Service.getManifest = jest.fn().mockRejectedValue(new Error());
                documents.getDocuments = jest.fn().mockRejectedValue(new Error());
                store.del = jest.fn().mockImplementation((key, callback) => callback(undefined, 0));
                store.get = jest.fn().mockImplementation((key, callback) => callback(undefined, 'Thorn'));
                store.set = jest.fn().mockImplementation((key, value, callback) => callback(undefined, 'OK'));

                const { failures, health } = await healthController.getHealth();

                expect(failures).toEqual(6);
                expect(health).toEqual({
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
            });
        });
    });
});
