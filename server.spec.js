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
    publisherClose,
    consentQueueClose,
    subscriberClose,
    processExternalPromisesWithTimeout,
    trackMetric,
    logInfo,
    logError,
    readStartupEventLoopDelay,
} = vi.hoisted(() => ({
    createServer: vi.fn(),
    createTerminus: vi.fn(),
    loadersInit: vi.fn(),
    startGrpcServer: vi.fn(),
    stopGrpcServer: vi.fn(),
    cacheQuit: vi.fn(),
    jobsQuit: vi.fn(),
    poolClose: vi.fn(),
    publisherClose: vi.fn(),
    consentQueueClose: vi.fn(),
    subscriberClose: vi.fn(),
    processExternalPromisesWithTimeout: vi.fn(),
    trackMetric: vi.fn(),
    logInfo: vi.fn(),
    logError: vi.fn(),
    readStartupEventLoopDelay: vi.fn(),
}));

vi.mock('node:http', () => ({ createServer }));
vi.mock('@godaddy/terminus', () => ({ createTerminus }));
vi.mock('./loaders/index.js', () => ({ default: { init: loadersInit } }));
vi.mock('./grpc.js', () => ({ startServer: startGrpcServer, stopServer: stopGrpcServer }));
vi.mock('./helpers/cache.js', () => ({ default: { quit: cacheQuit } }));
vi.mock('./helpers/jobs.js', () => ({ default: { quit: jobsQuit } }));
vi.mock('./helpers/pool.js', () => ({ default: { close: poolClose } }));
vi.mock('./helpers/publisher.js', () => ({ default: { close: publisherClose } }));
vi.mock('./helpers/subscriber.js', () => ({ default: { close: subscriberClose } }));
vi.mock('./twilio/consent.queue.js', () => ({ default: { close: consentQueueClose } }));
vi.mock('./helpers/process-external-promises-with-timeout.js', () => ({
    default: processExternalPromisesWithTimeout,
}));
vi.mock('./helpers/application-insights.js', () => ({ default: { trackMetric } }));
vi.mock('./helpers/log.js', () => ({ default: { info: logInfo, error: logError } }));
vi.mock('./helpers/event-loop-delay.js', () => ({ readStartupEventLoopDelay }));

const world2 = { items: [] };
const workers = [subscriberClose];
const producers = [publisherClose, consentQueueClose];
const connections = [cacheQuit, jobsQuit, poolClose];
const allCloses = [...workers, ...producers, ...connections];
const settle = () => new Promise(resolve => setImmediate(resolve));

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

describe('startServer once listening', () => {
    const startupDelay = { p50: 1, p95: 2, p99: 30, max: 63_173 };

    beforeEach(() => {
        vi.resetAllMocks();
        createServer.mockReturnValue({
            listen: vi.fn((_port, callback) => {
                callback();
                return {};
            }),
            address: vi.fn().mockReturnValue({ port: 1100 }),
        });
        loadersInit.mockResolvedValue({ world2 });
        readStartupEventLoopDelay.mockResolvedValue(startupDelay);
    });

    it("should report startup's event-loop delay on its own, and the time since the process started", async () => {
        await startServer();

        expect(readStartupEventLoopDelay).toHaveBeenCalledOnce();
        await vi.waitFor(() => expect(logInfo).toHaveBeenCalled());
        expect(trackMetric).toHaveBeenCalledWith({
            name: 'Startup Event Loop Delay max',
            value: startupDelay.max,
        });
        expect(logInfo).toHaveBeenCalledWith(
            expect.objectContaining({
                eventLoopDelay: startupDelay,
                sinceProcessStart: expect.any(Number),
            }),
            'HTTP server is listening',
        );
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
        for (const close of allCloses) {
            close.mockResolvedValue(undefined);
        }
        createTerminus.mockImplementation((_server, options) => {
            onSignal = options.onSignal;
        });
        processExternalPromisesWithTimeout.mockImplementation(async externalPromises =>
            Promise.allSettled(externalPromises),
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
        for (const close of allCloses) {
            expect(close).not.toHaveBeenCalled();
        }
        expect(processExternalPromisesWithTimeout).not.toHaveBeenCalled();

        grpcShutdown.resolve();
        await shutdown;

        for (const close of allCloses) {
            expect(close).toHaveBeenCalledOnce();
        }
        expect(httpServer.close).not.toHaveBeenCalled();
        expect(processExternalPromisesWithTimeout.mock.calls).toEqual([
            [[expect.any(Promise)], 10_000],
            [[expect.any(Promise), expect.any(Promise)], 3000],
            [[expect.any(Promise), expect.any(Promise), expect.any(Promise)], 3000],
        ]);
    });

    it('keeps producers and connections open until the workers have drained', async () => {
        const draining = Promise.withResolvers();
        subscriberClose.mockReturnValue(draining.promise);

        await startServer();
        const shutdown = onSignal();
        await settle();

        expect(subscriberClose).toHaveBeenCalledOnce();
        for (const close of [...producers, ...connections]) {
            expect(close).not.toHaveBeenCalled();
        }

        draining.resolve();
        await shutdown;

        for (const close of [...producers, ...connections]) {
            expect(close).toHaveBeenCalledOnce();
        }
    });

    it('keeps connections open until the producers have closed', async () => {
        const closing = Promise.withResolvers();
        publisherClose.mockReturnValue(closing.promise);

        await startServer();
        const shutdown = onSignal();
        await settle();

        for (const close of [...workers, ...producers]) {
            expect(close).toHaveBeenCalledOnce();
        }
        for (const close of connections) {
            expect(close).not.toHaveBeenCalled();
        }

        closing.resolve();
        await shutdown;

        for (const close of connections) {
            expect(close).toHaveBeenCalledOnce();
        }
    });

    it('moves on to the next stage when a drain times out', async () => {
        const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
        subscriberClose.mockReturnValue(new Promise(() => {}));
        processExternalPromisesWithTimeout.mockResolvedValueOnce([{ status: 'timed-out' }]);

        await startServer();
        await onSignal();

        for (const close of [...producers, ...connections]) {
            expect(close).toHaveBeenCalledOnce();
        }
        expect(consoleError).toHaveBeenCalledWith('Subscriber failed to shut down in time');
        consoleError.mockRestore();
    });

    it('moves on to the next stage when a close throws', async () => {
        const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
        const err = new Error('already closed');
        publisherClose.mockImplementation(() => {
            throw err;
        });

        await startServer();
        await expect(onSignal()).resolves.toBeUndefined();

        for (const close of connections) {
            expect(close).toHaveBeenCalledOnce();
        }
        expect(consoleError).toHaveBeenCalledWith('Publisher failed to shut down', err);
        consoleError.mockRestore();
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
            for (const close of allCloses) {
                expect(close).toHaveBeenCalledOnce();
            }
            expect(processExternalPromisesWithTimeout).toHaveBeenCalledTimes(3);
            expect(httpServer.close).not.toHaveBeenCalled();
        },
    );
});
