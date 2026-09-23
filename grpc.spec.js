import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import grpc from '@grpc/grpc-js';
import { createGetAllHandler, startServer, stopServer } from './grpc.js';
import log from './helpers/log.js';

vi.mock('./helpers/config.js', () => ({
    default: {
        notificationHeaders: { 'x-test-header': 'test-value' },
    },
}));
vi.mock('./helpers/pool.js', () => ({ default: {} }));
vi.mock('./helpers/world2.js', () => ({ default: vi.fn() }));
vi.mock('./helpers/log.js', () => ({
    default: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

describe('stopServer', () => {
    let grpcServer;
    let started;

    beforeEach(() => {
        vi.useFakeTimers();
        started = false;
        grpcServer = {
            addService: vi.fn(),
            bindAsync: vi.fn((_address, _credentials, callback) => callback(null, 1102)),
            tryShutdown: vi.fn(),
            forceShutdown: vi.fn(),
        };
        vi.spyOn(grpc, 'Server').mockImplementation(
            class {
                constructor() {
                    Object.assign(this, grpcServer);
                }
            },
        );
    });

    afterEach(async () => {
        if (started) {
            const shutdown = stopServer();
            await vi.runAllTimersAsync();
            await shutdown;
        }
        vi.useRealTimers();
        vi.restoreAllMocks();
    });

    it('resolves when the server has not started', async () => {
        await expect(stopServer()).resolves.toBeUndefined();
        expect(grpcServer.forceShutdown).not.toHaveBeenCalled();
    });

    it('waits for graceful completion and clears the fallback timer', async () => {
        started = true;
        await startServer();
        const completed = vi.fn();
        const shutdown = stopServer().then(completed);

        await Promise.resolve();
        expect(completed).not.toHaveBeenCalled();
        expect(grpcServer.forceShutdown).not.toHaveBeenCalled();

        grpcServer.tryShutdown.mock.calls[0][0]();
        await shutdown;

        expect(completed).toHaveBeenCalledOnce();
        expect(log.info).toHaveBeenCalledWith('GRPC server shut down');
        expect(vi.getTimerCount()).toBe(0);
        await vi.advanceTimersByTimeAsync(3000);
        expect(grpcServer.forceShutdown).not.toHaveBeenCalled();
        await expect(stopServer()).resolves.toBeUndefined();
        expect(grpcServer.tryShutdown).toHaveBeenCalledOnce();
    });

    it('forces shutdown after three seconds and ignores a late callback', async () => {
        started = true;
        await startServer();
        const completed = vi.fn();
        const shutdown = stopServer().then(completed);

        await vi.advanceTimersByTimeAsync(2999);
        expect(completed).not.toHaveBeenCalled();
        expect(grpcServer.forceShutdown).not.toHaveBeenCalled();

        await vi.advanceTimersByTimeAsync(1);
        await shutdown;
        expect(grpcServer.forceShutdown).toHaveBeenCalledOnce();
        expect(log.warn).toHaveBeenCalled();

        grpcServer.tryShutdown.mock.calls[0][0]();
        expect(grpcServer.forceShutdown).toHaveBeenCalledOnce();
        expect(log.info).not.toHaveBeenCalledWith('GRPC server shut down');
        expect(completed).toHaveBeenCalledOnce();
        expect(vi.getTimerCount()).toBe(0);
    });

    it('resolves only once the port is bound', async () => {
        let bound;
        grpcServer.bindAsync.mockImplementation((_address, _credentials, callback) => {
            bound = callback;
        });

        const listening = vi.fn();
        const start = startServer().then(listening);

        await Promise.resolve();
        expect(listening).not.toHaveBeenCalled();

        bound(null, 1102);
        await start;

        expect(listening).toHaveBeenCalledOnce();
        expect(log.info).toHaveBeenCalledWith({ port: 1102 }, 'GRPC server is listening');

        started = true;
    });

    it('rejects when the port cannot be bound', async () => {
        const err = new Error('EADDRINUSE');
        grpcServer.bindAsync.mockImplementation((_address, _credentials, callback) =>
            callback(err),
        );

        await expect(startServer()).rejects.toBe(err);

        await expect(stopServer()).resolves.toBeUndefined();
        expect(grpcServer.tryShutdown).not.toHaveBeenCalled();
    });

    it('does not let a later start adopt a server from an attempt that was stopped', async () => {
        const binds = [];
        grpcServer.bindAsync.mockImplementation((_address, _credentials, callback) => {
            binds.push(callback);
        });

        const first = startServer();

        await expect(stopServer()).resolves.toBeUndefined();

        const second = startServer();

        binds[0](null, 1102);
        await first;

        expect(grpcServer.forceShutdown).toHaveBeenCalledOnce();

        binds[1](null, 1102);
        await second;

        expect(grpcServer.forceShutdown).toHaveBeenCalledOnce();
        expect(log.info).toHaveBeenCalledExactlyOnceWith(
            { port: 1102 },
            'GRPC server is listening',
        );

        started = true;
    });

    it('ignores a bind failure that lands after shutdown began', async () => {
        let bound;
        grpcServer.bindAsync.mockImplementation((_address, _credentials, callback) => {
            bound = callback;
        });

        const start = startServer();

        await expect(stopServer()).resolves.toBeUndefined();

        bound(new Error('EADDRINUSE'));

        await expect(start).resolves.toBeUndefined();
        expect(log.warn).toHaveBeenCalledWith(
            { err: expect.any(Error) },
            'GRPC bind failed after shutdown began; ignoring',
        );
        expect(grpcServer.forceShutdown).not.toHaveBeenCalled();
    });

    it('closes a server that finishes binding after shutdown rather than orphaning it', async () => {
        let bound;
        grpcServer.bindAsync.mockImplementation((_address, _credentials, callback) => {
            bound = callback;
        });

        const start = startServer();

        await expect(stopServer()).resolves.toBeUndefined();
        expect(grpcServer.tryShutdown).not.toHaveBeenCalled();

        bound(null, 1102);
        await start;

        expect(grpcServer.forceShutdown).toHaveBeenCalledOnce();
        expect(log.warn).toHaveBeenCalledWith(
            'GRPC server bound after shutdown; closing it immediately',
        );
        expect(log.info).not.toHaveBeenCalledWith({ port: 1102 }, 'GRPC server is listening');

        await expect(stopServer()).resolves.toBeUndefined();
        expect(grpcServer.tryShutdown).not.toHaveBeenCalled();
    });
});

const createCall = ({ headerValue = 'test-value', page = undefined, size = undefined } = {}) => ({
    metadata: {
        get: key => (key === 'x-test-header' ? [headerValue] : []),
    },
    request: { page, size },
});

describe('createGetAllHandler', () => {
    let callback;
    let world;

    beforeEach(() => {
        callback = vi.fn();
        world = { items: Array.from({ length: 33 }, (_, i) => ({ hash: i })) };
    });

    describe('authentication', () => {
        it('returns UNAUTHENTICATED when header value is wrong', () => {
            const handler = createGetAllHandler(world);

            handler(createCall({ headerValue: 'wrong' }), callback);

            expect(callback).toHaveBeenCalledWith({
                code: grpc.status.UNAUTHENTICATED,
                message: 'Invalid or missing metadata for "x-test-header".',
            });
        });
    });

    describe('world not ready', () => {
        it('returns UNAVAILABLE when items is undefined', () => {
            const handler = createGetAllHandler({ items: undefined });

            handler(createCall(), callback);

            expect(callback).toHaveBeenCalledWith({
                code: grpc.status.UNAVAILABLE,
                message: 'No items are currently available.',
            });
        });

        it('returns UNAVAILABLE when items is empty', () => {
            const handler = createGetAllHandler({ items: [] });

            handler(createCall(), callback);

            expect(callback).toHaveBeenCalledWith({
                code: grpc.status.UNAVAILABLE,
                message: 'No items are currently available.',
            });
        });
    });

    describe('parameter validation', () => {
        it('returns INVALID_ARGUMENT when page is 0', () => {
            const handler = createGetAllHandler(world);

            handler(createCall({ page: 0 }), callback);

            expect(callback).toHaveBeenCalledWith({
                code: grpc.status.INVALID_ARGUMENT,
                message: 'page and size must be greater than or equal to 1.',
            });
        });

        it('returns INVALID_ARGUMENT when size is 0', () => {
            const handler = createGetAllHandler(world);

            handler(createCall({ size: 0 }), callback);

            expect(callback).toHaveBeenCalledWith({
                code: grpc.status.INVALID_ARGUMENT,
                message: 'page and size must be greater than or equal to 1.',
            });
        });

        it('returns OUT_OF_RANGE when page exceeds total pages', () => {
            const handler = createGetAllHandler(world);

            handler(createCall({ page: 999, size: 10 }), callback);

            expect(callback).toHaveBeenCalledWith({
                code: grpc.status.OUT_OF_RANGE,
                message: 'Requested page 999 exceeds available pages (4).',
            });
        });
    });

    describe('pagination', () => {
        it('defaults to page 1, size 11 when request fields are null', () => {
            const handler = createGetAllHandler(world);

            handler(createCall(), callback);

            const [, response] = callback.mock.calls[0];

            expect(response.page.number).toBe(1);
            expect(response.page.size).toBe(11);
            expect(response.data).toHaveLength(11);
        });

        it('returns the correct slice for a given page', () => {
            const handler = createGetAllHandler(world);

            handler(createCall({ page: 2, size: 10 }), callback);

            const [, response] = callback.mock.calls[0];

            expect(response.data[0].hash).toBe(10);
            expect(response.data).toHaveLength(10);
        });

        it('sets links.next_page to the next page number when more pages exist', () => {
            const handler = createGetAllHandler(world);

            handler(createCall({ page: 1, size: 10 }), callback);

            const [, response] = callback.mock.calls[0];

            expect(response.links.next_page).toBe('2');
        });

        it('sets links.next_page to empty string on the last page', () => {
            const handler = createGetAllHandler(world);

            handler(createCall({ page: 4, size: 10 }), callback);

            const [, response] = callback.mock.calls[0];

            expect(response.links.next_page).toBe('');
        });

        it('returns correct page metadata', () => {
            const handler = createGetAllHandler(world);

            handler(createCall({ page: 2, size: 10 }), callback);

            const [, response] = callback.mock.calls[0];

            expect(response.page).toEqual({
                size: 10,
                total: 33,
                pages: 4,
                number: 2,
            });
        });
    });
});
