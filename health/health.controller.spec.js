import { readFileSync } from 'node:fs';
import { totalmem } from 'node:os';
import { getHeapStatistics } from 'node:v8';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { get } from '../helpers/request.js';
import applicationInsights from '../helpers/application-insights.js';
import HealthController from './health.controller.js';
import manifestResponse from '../mocks/manifestResponse.json';
import manifest2Response from '../mocks/manifest2Response.json';

vi.mock('node:fs', async importOriginal => {
    const actual = await importOriginal();

    return { ...actual, readFileSync: vi.fn(actual.readFileSync) };
});
vi.mock('../helpers/request.js');
vi.mock('../helpers/bungie.request.js', () => ({
    getCircuitBreakerStatus: vi.fn(() => ({
        state: 'closed',
        stats: { failures: 0, rejects: 0, successes: 0, timeouts: 0 },
    })),
}));
vi.mock('../helpers/application-insights.js', () => ({
    default: {
        trackMetric: vi.fn(),
    },
}));
vi.mock('../helpers/log.js', () => ({
    default: {
        error: vi.fn(),
        info: vi.fn(),
    },
}));

const megabyte = 1024 * 1024;
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
                getGrimoireCards: () =>
                    Promise.resolve([
                        {
                            cardName: 'Red Hand IX',
                        },
                    ]),
            };
            const world2 = {
                getItemByName: () =>
                    Promise.resolve([
                        {
                            itemName: 'Eyasluna',
                            itemTypeAndTierDisplayName: 'Legendary Hand Cannon',
                        },
                    ]),
            };

            beforeEach(() => {
                get.mockImplementation(() =>
                    Promise.resolve({
                        status: {
                            description: 'All Systems Go',
                        },
                    }),
                );

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
                store.del = vi.fn().mockImplementation((_key, callback) => callback(undefined, 1));
                store.get = vi
                    .fn()
                    .mockImplementation((_key, callback) => callback(undefined, 'Thorn'));
                store.set = vi
                    .fn()
                    .mockImplementation((_key, _value, callback) => callback(undefined, 'OK'));

                const { failures, health } = await healthController.getHealth();

                expect(failures).toEqual(0);
                expect(health).toEqual({
                    bungie: {
                        state: 'closed',
                        stats: { failures: 0, rejects: 0, successes: 0, timeouts: 0 },
                    },
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
                get.mockImplementation(() =>
                    Promise.reject({
                        statusCode: 400,
                    }),
                );

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
                store.del = vi.fn().mockImplementation((_key, callback) => callback(undefined, 0));
                store.get = vi
                    .fn()
                    .mockImplementation((_key, callback) => callback(undefined, 'Thorn'));
                store.set = vi
                    .fn()
                    .mockImplementation((_key, _value, callback) => callback(undefined, 'OK'));

                const { failures, health } = await healthController.getHealth();

                expect(failures).toEqual(6);
                expect(health).toEqual({
                    bungie: {
                        state: 'closed',
                        stats: { failures: 0, rejects: 0, successes: 0, timeouts: 0 },
                    },
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

    describe('getSwap', () => {
        it('should return VmSwap from /proc/self/status in bytes', () => {
            vi.mocked(readFileSync).mockReturnValueOnce(
                'VmRSS:\t  376832 kB\nVmSwap:\t  262144 kB\n',
            );

            expect(HealthController.getSwap()).toBe(256 * megabyte);
            expect(readFileSync).toHaveBeenCalledWith('/proc/self/status', 'utf8');
        });

        it('should return undefined when /proc/self/status cannot be read', () => {
            vi.mocked(readFileSync).mockImplementationOnce(() => {
                throw Object.assign(new Error('Access to this API has been restricted'), {
                    code: 'ERR_ACCESS_DENIED',
                });
            });

            expect(HealthController.getSwap()).toBeUndefined();
        });
    });

    describe('getMemoryUsage', () => {
        beforeEach(() => {
            vi.spyOn(process, 'memoryUsage').mockReturnValue({
                rss: 512 * megabyte,
                heapTotal: 400 * megabyte,
                heapUsed: 300 * megabyte,
                external: 7 * megabyte,
                arrayBuffers: 0,
            });
        });

        afterEach(() => vi.restoreAllMocks());

        it('should count swap against the container limit when it is the smaller limit', () => {
            vi.spyOn(HealthController, 'getSwap').mockReturnValue(256 * megabyte);
            vi.spyOn(process, 'constrainedMemory').mockReturnValue(1024 * megabyte);

            const result = HealthController.getMemoryUsage();

            expect(result).toEqual({
                rss: 512,
                swap: 256,
                heapTotal: 400,
                heapUsed: 300,
                external: 7,
                heapSizeLimit: Math.floor(getHeapStatistics().heap_size_limit / megabyte),
                percentageOfHeapLimit: Math.round(
                    ((300 * megabyte) / getHeapStatistics().heap_size_limit) * 100,
                ),
                memoryLimit: 1024,
                percentageOfMemoryLimit: 75,
            });
        });

        it.each([
            ['no limit is detected', 0],
            ['the cgroup reports no limit as 2^64', 2 ** 64],
        ])('should fall back to physical memory when %s', (_description, constrainedMemory) => {
            vi.spyOn(HealthController, 'getSwap').mockReturnValue(undefined);
            vi.spyOn(process, 'constrainedMemory').mockReturnValue(constrainedMemory);

            const result = HealthController.getMemoryUsage();

            expect(result.swap).toBeUndefined();
            expect(result.memoryLimit).toBe(Math.floor(totalmem() / megabyte));
            expect(result.percentageOfMemoryLimit).toBe(
                Math.round(((512 * megabyte) / totalmem()) * 100),
            );
        });
    });

    describe('getMetrics', () => {
        it('should return memory metrics and track the percentage of the memory limit', async () => {
            const controller = new HealthController();

            const { memory, eventLoopDelay } = await controller.getMetrics();

            expect(eventLoopDelay).toEqual({
                p50: expect.any(Number),
                p95: expect.any(Number),
                p99: expect.any(Number),
                max: expect.any(Number),
            });
            expect(applicationInsights.trackMetric).toHaveBeenCalledWith({
                name: 'Event Loop Delay p99',
                value: eventLoopDelay.p99,
            });

            expect(memory).toHaveProperty('rss');
            expect(memory).toHaveProperty('heapSizeLimit');
            expect(memory).toHaveProperty('memoryLimit');
            expect(applicationInsights.trackMetric).toHaveBeenCalledWith({
                name: 'Percentage of Memory Limit',
                value: memory.percentageOfMemoryLimit,
            });
        });
    });
});
