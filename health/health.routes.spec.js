import { EventEmitter } from 'events';
import {
    beforeEach, describe, expect, it, vi,
} from 'vitest';
import { StatusCodes } from 'http-status-codes';
import { createResponse, createRequest } from 'node-mocks-http';
import { get } from '../helpers/request';
import HealthRouter from './health.routes';
import manifestResponse from '../mocks/manifestResponse.json';
import manifest2Response from '../mocks/manifest2Response.json';

vi.mock('../helpers/request');

const { Response: manifest } = manifestResponse;
const { Response: manifest2 } = manifest2Response;
const destinyService = {
    getManifest: vi.fn(),
};
const destiny2Service = {
    getManifest: vi.fn(),
};
const documents = {
    getDocuments: vi.fn(),
};

let healthRouter;

describe('HealthRouter', () => {
    const next = vi.fn();
    let res;

    beforeEach(() => {
        res = createResponse({
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
                get.mockImplementation(() => Promise.resolve({
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

            it('should return a positive response', async () => {
                const req = createRequest({
                    method: 'GET',
                    url: '/',
                });

                destinyService.getManifest = vi.fn().mockResolvedValue({ data: { manifest } });
                destiny2Service.getManifest = vi.fn().mockResolvedValue({
                    data: {
                        manifest: manifest2,
                    },
                });
                documents.getDocuments = vi.fn().mockResolvedValue([2]);

                res.on('end', () => {
                    expect(res.statusCode).toEqual(StatusCodes.OK);

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
                });

                await healthRouter(req, res, next);
            });
        });

        describe('when all services are unhealthy', async () => {
            const world = {
                close: () => Promise.resolve(),
                getItemByName: () => Promise.reject(new Error()),
                open: () => Promise.resolve(),
            };
            const world2 = world;

            beforeEach(() => {
                get.mockImplementation(() => Promise.rejects({
                    statusCode: StatusCodes.BAD_REQUEST,
                }));

                healthRouter = HealthRouter({
                    destinyService,
                    destiny2Service,
                    documents,
                    worldRepository: world,
                    world2Repository: world2,
                });
            });

            it('should return a negative response', async () => {
                const req = createRequest({
                    method: 'GET',
                    url: '/',
                });

                destinyService.getManifest = vi.fn().mockRejectedValue(new Error());
                destiny2Service.getManifest = vi.fn().mockRejectedValue(new Error());
                documents.getDocuments = vi.fn().mockRejectedValue(new Error());

                res.on('end', () => {
                    expect(res.statusCode).toEqual(StatusCodes.SERVICE_UNAVAILABLE);

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
                });

                await healthRouter(req, res, next);
            });
        });
    });
});
