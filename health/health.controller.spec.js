import {
    beforeEach, describe, expect, it, vi,
} from 'vitest';
import { get } from '../helpers/request.js';
import applicationInsights from '../helpers/application-insights.js';
import HealthController from './health.controller.js';
import manifestResponse from '../mocks/manifestResponse.json';
import manifest2Response from '../mocks/manifest2Response.json';

vi.mock('../helpers/request');
vi.mock('../helpers/application-insights', () => ({
    default: {
        trackMetric: vi.fn(),
    },
}));
vi.mock('../helpers/log', () => ({
    default: {
        error: vi.fn(),
        info: vi.fn(),
    },
}));

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
const store = {
    del: vi.fn(),
    get: vi.fn(),
    set: vi.fn(),
};

let healthController;

describe('HealthController', () => {
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
                destinyService.getManifest = vi.fn().mockResolvedValue({ data: { manifest } });
                destiny2Service.getManifest = vi.fn().mockResolvedValue({
                    data: {
                        manifest: manifest2,
                    },
                });
                documents.getDocuments = vi.fn().mockResolvedValue([2]);
                store.del = vi.fn().mockImplementation((key, callback) => callback(undefined, 1));
                store.get = vi.fn().mockImplementation((key, callback) => callback(undefined, 'Thorn'));
                store.set = vi.fn().mockImplementation((key, value, callback) => callback(undefined, 'OK'));

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
                        world: 'Eyasluna Legendary Hand Cannon',
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
                get.mockImplementation(() => Promise.rejects({
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
                destinyService.getManifest = vi.fn().mockRejectedValue(new Error());
                destiny2Service.getManifest = vi.fn().mockRejectedValue(new Error());
                documents.getDocuments = vi.fn().mockRejectedValue(new Error());
                store.del = vi.fn().mockImplementation((key, callback) => callback(undefined, 0));
                store.get = vi.fn().mockImplementation((key, callback) => callback(undefined, 'Thorn'));
                store.set = vi.fn().mockImplementation((key, value, callback) => callback(undefined, 'OK'));

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

    describe('getMemoryUsage', () => {
        it('should return memory usage in megabytes', () => {
            const result = HealthController.getMemoryUsage();

            expect(result).toHaveProperty('rss');
            expect(result).toHaveProperty('heapTotal');
            expect(result).toHaveProperty('heapUsed');
            expect(result).toHaveProperty('external');
            expect(result).toHaveProperty('totalAvailableSize');
            Object.values(result).forEach(value => {
                expect(typeof value).toBe('number');
            });
        });
    });

    describe('getMetrics', () => {
        it('should return memory metrics and track them', async () => {
            const controller = new HealthController();

            const { memory } = await controller.getMetrics();

            expect(memory).toHaveProperty('rss');
            expect(memory).toHaveProperty('heapTotal');
            expect(memory).toHaveProperty('heapUsed');
            expect(memory).toHaveProperty('external');
            expect(memory).toHaveProperty('totalAvailableSize');
            expect(applicationInsights.trackMetric).toHaveBeenCalledWith({
                name: 'Ratio of RSS Memory to Total Available Size',
                value: expect.any(Number),
            });
        });
    });
});
