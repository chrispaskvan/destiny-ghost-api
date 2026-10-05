import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { startServer, stopServer } from './server.js';

const {
    createServer,
    createTerminus,
    loadersInit,
    startGrpcServer,
    stopGrpcServer,
    cacheQuit,
    jobsQuit,
    poolClose,
    subscriberClose,
    processExternalPromisesWithTimeout,
    trackMetric,
    logInfo,
    logError,
} = vi.hoisted(() => ({
    createServer: vi.fn(),
    createTerminus: vi.fn(),
    loadersInit: vi.fn(),
    startGrpcServer: vi.fn(),
    stopGrpcServer: vi.fn(),
    cacheQuit: vi.fn(),
    jobsQuit: vi.fn(),
    poolClose: vi.fn(),
    subscriberClose: vi.fn(),
    processExternalPromisesWithTimeout: vi.fn(),
    trackMetric: vi.fn(),
    logInfo: vi.fn(),
    logError: vi.fn(),
}));

vi.mock('node:http', () => ({ createServer }));
vi.mock('@godaddy/terminus', () => ({ createTerminus }));
vi.mock('./loaders/index.js', () => ({ default: { init: loadersInit } }));
vi.mock('./grpc.js', () => ({ startServer: startGrpcServer, stopServer: stopGrpcServer }));
vi.mock('./helpers/cache.js', () => ({ default: { quit: cacheQuit } }));
vi.mock('./helpers/jobs.js', () => ({ default: { quit: jobsQuit } }));
vi.mock('./helpers/pool.js', () => ({ default: { close: poolClose } }));
vi.mock('./helpers/subscriber.js', () => ({ default: { close: subscriberClose } }));
vi.mock('./helpers/process-external-promises-with-timeout.js', () => ({
    default: processExternalPromisesWithTimeout,
}));
vi.mock('./helpers/application-insights.js', () => ({ default: { trackMetric } }));
vi.mock('./helpers/log.js', () => ({ default: { info: logInfo, error: logError } }));

const world2 = { items: [] };

describe('startServer gRPC', () => {
    beforeEach(() => {
        vi.resetAllMocks();
        createServer.mockReturnValue({
            listen: vi.fn().mockReturnThis(),
            address: vi.fn().mockReturnValue({ port: 1100 }),
        });
        loadersInit.mockResolvedValue({ world2 });
        startGrpcServer.mockResolvedValue(undefined);
    });

    it("should start gRPC on the REST API's World2 when asked", async () => {
        await startServer({ grpc: true });

        expect(startGrpcServer).toHaveBeenCalledExactlyOnceWith({ world: world2 });
    });

    it('should not start gRPC otherwise, as for the integration tests', async () => {
        await startServer();

        expect(startGrpcServer).not.toHaveBeenCalled();
    });

    it('should reject when gRPC fails to start, for start.js to exit on', async () => {
        const err = new Error('EADDRINUSE');

        startGrpcServer.mockRejectedValue(err);

        await expect(startServer({ grpc: true })).rejects.toBe(err);
    });
});

describe('startServer shutdown wiring', () => {
    let onSignal;
    let httpServer;

    beforeEach(() => {
        vi.resetAllMocks();
        httpServer = {
            listen: vi.fn().mockReturnThis(),
            address: vi.fn().mockReturnValue({ port: 1100 }),
            close: vi.fn(),
        };
        createServer.mockReturnValue(httpServer);
        onSignal = undefined;
        loadersInit.mockResolvedValue({ world2 });
        for (const close of [cacheQuit, jobsQuit, poolClose, subscriberClose]) {
            close.mockResolvedValue(undefined);
        }
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
    });

    it('drains grpc before closing shared resources on shutdown', async () => {
        const grpcShutdown = Promise.withResolvers();
        stopGrpcServer.mockReturnValue(grpcShutdown.promise);

        await startServer();

        expect(createTerminus).toHaveBeenCalledOnce();
        expect(onSignal).toEqual(expect.any(Function));

        const shutdown = onSignal();
        await Promise.resolve();
        expect(stopGrpcServer).toHaveBeenCalledOnce();
        for (const close of [cacheQuit, jobsQuit, poolClose, subscriberClose]) {
            expect(close).not.toHaveBeenCalled();
        }
        expect(processExternalPromisesWithTimeout).not.toHaveBeenCalled();

        grpcShutdown.resolve();
        await shutdown;

        for (const close of [cacheQuit, jobsQuit, poolClose, subscriberClose]) {
            expect(close).toHaveBeenCalledOnce();
        }
        expect(httpServer.close).not.toHaveBeenCalled();
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
    });

    it.each(['rejects', 'throws'])(
        'continues shared-resource cleanup when grpc shutdown %s',
        async failure => {
            const err = new Error('GRPC shutdown failed');
            if (failure === 'rejects') {
                stopGrpcServer.mockRejectedValue(err);
            } else {
                stopGrpcServer.mockImplementation(() => {
                    throw err;
                });
            }

            await startServer();
            await expect(onSignal()).resolves.toBeUndefined();

            expect(stopGrpcServer).toHaveBeenCalledOnce();
            expect(logError).toHaveBeenCalledExactlyOnceWith({ err }, 'GRPC failed to shut down');
            for (const close of [cacheQuit, jobsQuit, poolClose, subscriberClose]) {
                expect(close).toHaveBeenCalledOnce();
            }
            expect(processExternalPromisesWithTimeout).toHaveBeenCalledOnce();
            expect(httpServer.close).not.toHaveBeenCalled();
        },
    );
});
