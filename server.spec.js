import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { startServer, stopServer } from './server.js';

const {
    createTerminus,
    loadersInit,
    stopGrpcServer,
    cacheQuit,
    jobsQuit,
    poolClose,
    subscriberClose,
    processExternalPromisesWithTimeout,
    trackMetric,
    logInfo,
} = vi.hoisted(() => ({
    createTerminus: vi.fn(),
    loadersInit: vi.fn(),
    stopGrpcServer: vi.fn(),
    cacheQuit: vi.fn(),
    jobsQuit: vi.fn(),
    poolClose: vi.fn(),
    subscriberClose: vi.fn(),
    processExternalPromisesWithTimeout: vi.fn(),
    trackMetric: vi.fn(),
    logInfo: vi.fn(),
}));

vi.mock('@godaddy/terminus', () => ({ createTerminus }));
vi.mock('./loaders/index.js', () => ({ default: { init: loadersInit } }));
vi.mock('./grpc.js', () => ({ stopServer: stopGrpcServer }));
vi.mock('./helpers/cache.js', () => ({ default: { quit: cacheQuit } }));
vi.mock('./helpers/jobs.js', () => ({ default: { quit: jobsQuit } }));
vi.mock('./helpers/pool.js', () => ({ default: { close: poolClose } }));
vi.mock('./helpers/subscriber.js', () => ({ default: { close: subscriberClose } }));
vi.mock('./helpers/process-external-promises-with-timeout.js', () => ({
    default: processExternalPromisesWithTimeout,
}));
vi.mock('./helpers/application-insights.js', () => ({ default: { trackMetric } }));
vi.mock('./helpers/log.js', () => ({ default: { info: logInfo, error: vi.fn() } }));

describe('startServer shutdown wiring', () => {
    let onSignal;

    beforeEach(() => {
        vi.resetAllMocks();
        process.env.PORT = '0';
        onSignal = undefined;
        loadersInit.mockResolvedValue(undefined);
        createTerminus.mockImplementation((_server, options) => {
            onSignal = options.onSignal;
        });
        processExternalPromisesWithTimeout.mockImplementation(async externalPromises =>
            Promise.all(externalPromises).then(results =>
                results.map(value => ({ status: 'fulfilled', value })),
            ),
        );
    });

    afterEach(async () => {
        await stopServer();
        delete process.env.PORT;
    });

    it('drains grpc before closing shared resources on shutdown', async () => {
        const shutdownOrder = [];

        stopGrpcServer.mockImplementation(async () => {
            shutdownOrder.push('grpc');
        });
        cacheQuit.mockImplementation(async () => {
            shutdownOrder.push('cache');
        });
        jobsQuit.mockImplementation(async () => {
            shutdownOrder.push('jobs');
        });
        poolClose.mockImplementation(async () => {
            shutdownOrder.push('pool');
        });
        subscriberClose.mockImplementation(async () => {
            shutdownOrder.push('subscriber');
        });

        await startServer();

        expect(createTerminus).toHaveBeenCalledOnce();
        expect(onSignal).toEqual(expect.any(Function));

        await onSignal();

        expect(stopGrpcServer).toHaveBeenCalledOnce();
        expect(processExternalPromisesWithTimeout).toHaveBeenCalledOnce();
        expect(processExternalPromisesWithTimeout).toHaveBeenCalledWith(
            expect.arrayContaining([
                expect.any(Promise),
                expect.any(Promise),
                expect.any(Promise),
                expect.any(Promise),
            ]),
            3000,
        );
        expect(stopGrpcServer.mock.invocationCallOrder[0]).toBeLessThan(
            cacheQuit.mock.invocationCallOrder[0],
        );
        expect(stopGrpcServer.mock.invocationCallOrder[0]).toBeLessThan(
            jobsQuit.mock.invocationCallOrder[0],
        );
        expect(stopGrpcServer.mock.invocationCallOrder[0]).toBeLessThan(
            poolClose.mock.invocationCallOrder[0],
        );
        expect(stopGrpcServer.mock.invocationCallOrder[0]).toBeLessThan(
            subscriberClose.mock.invocationCallOrder[0],
        );
        expect(shutdownOrder).toEqual(['grpc', 'cache', 'jobs', 'pool', 'subscriber']);
    });
});
