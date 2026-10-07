import { EventEmitter } from 'node:events';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { StatusCodes } from 'http-status-codes';
import { createRequest, createResponse } from 'node-mocks-http';
import { accept, keepAlive, release, reserve } from '../helpers/idempotency-keys.js';
import log from '../helpers/log.js';
import NotificationRouter from './notification.routes.js';

const { controller } = vi.hoisted(() => ({
    controller: { create: vi.fn(), getBroadcast: vi.fn(), getClaimCheck: vi.fn() },
}));

vi.mock('@paralleldrive/cuid2', () => ({ createId: () => 'op-new' }));
vi.mock('../helpers/idempotency-keys.js', () => ({
    accept: vi.fn(),
    keepAlive: vi.fn(),
    release: vi.fn(),
    reserve: vi.fn(),
}));
vi.mock('../helpers/log.js', () => ({ default: { warn: vi.fn() } }));
vi.mock('../authorization/authorization.middleware.js', () => ({
    default: (_req, res, next) => {
        res.locals.caller = 'x-api-key';
        next();
    },
}));
vi.mock('./notification.controller.js', () => ({
    // biome-ignore lint/complexity/useArrowFunction: function expression required — `new` ignores return value of arrow functions
    default: vi.fn(function () {
        return controller;
    }),
}));

const reservation = {
    caller: 'x-api-key',
    key: 'xur-week-41',
    fingerprint: 'POST /notifications/Xur',
    operationId: 'op-new',
};

const settle = () => new Promise(resolve => setImmediate(resolve));

describe('NotificationRouter', () => {
    let router;
    let res;
    let stopKeepAlive;

    beforeEach(() => {
        vi.clearAllMocks();
        router = NotificationRouter({});
        res = createResponse({ eventEmitter: EventEmitter });
        accept.mockResolvedValue(true);
        release.mockResolvedValue(true);
        stopKeepAlive = vi.fn();
        keepAlive.mockReturnValue(stopKeepAlive);
        controller.create.mockResolvedValue({ claimCheckNumber: 'op-new' });
    });

    /**
     * Resolves with the error handed to `next`, or once the response ends.
     * @param {Record<string, string>} headers
     */
    const broadcast = (headers = { 'idempotency-key': reservation.key }) =>
        new Promise(resolve => {
            res.on('end', () => resolve(undefined));
            router(createRequest({ method: 'POST', url: '/Xur', headers }), res, err =>
                resolve(err),
            );
        });

    describe('POST /:subscription', () => {
        it.each([
            ['missing', {}],
            ['empty', { 'idempotency-key': '' }],
            ['too long', { 'idempotency-key': 'k'.repeat(256) }],
        ])('should refuse a %s Idempotency-Key', async (_label, headers) => {
            await broadcast(headers);

            expect(res.statusCode).toBe(StatusCodes.BAD_REQUEST);
            expect(reserve).not.toHaveBeenCalled();
        });

        it('should reserve the key before starting the broadcast, holding it meanwhile', async () => {
            reserve.mockResolvedValue({ outcome: 'reserved' });

            await broadcast();

            expect(reserve).toHaveBeenCalledExactlyOnceWith(reservation);
            expect(keepAlive).toHaveBeenCalledExactlyOnceWith(reservation);
            expect(controller.create).toHaveBeenCalledExactlyOnceWith('Xur', {
                operationId: 'op-new',
            });
            expect(reserve.mock.invocationCallOrder[0]).toBeLessThan(
                keepAlive.mock.invocationCallOrder[0],
            );
            expect(keepAlive.mock.invocationCallOrder[0]).toBeLessThan(
                controller.create.mock.invocationCallOrder[0],
            );
            expect(res.statusCode).toBe(StatusCodes.ACCEPTED);
            expect(res.getHeader('Destiny-Ghost-Postmaster')).toBe('op-new');
        });

        it('should accept the key, and answer 202, only once the broadcast is recorded', async () => {
            const recording = Promise.withResolvers();
            let answered = false;

            reserve.mockResolvedValue({ outcome: 'reserved' });
            controller.create.mockReturnValue(recording.promise);
            res.on('end', () => {
                answered = true;
            });

            const request = broadcast();

            await settle();
            expect(accept).not.toHaveBeenCalled();
            expect(answered).toBe(false);

            recording.resolve({ claimCheckNumber: 'op-new' });
            await request;

            expect(accept).toHaveBeenCalledExactlyOnceWith(reservation);
            expect(release).not.toHaveBeenCalled();
            expect(stopKeepAlive).toHaveBeenCalledOnce();
            expect(res.statusCode).toBe(StatusCodes.ACCEPTED);
        });

        it('should replay the original operation without starting another', async () => {
            reserve.mockResolvedValue({ outcome: 'replay', operationId: 'op-original' });

            await broadcast();

            expect(controller.create).not.toHaveBeenCalled();
            expect(res.statusCode).toBe(StatusCodes.ACCEPTED);
            expect(res.getHeader('Destiny-Ghost-Postmaster')).toBe('op-original');
        });

        it('should ask the client to retry while the key is still being processed', async () => {
            reserve.mockResolvedValue({ outcome: 'in-progress' });

            await broadcast();

            expect(controller.create).not.toHaveBeenCalled();
            expect(res.statusCode).toBe(StatusCodes.CONFLICT);
            expect(res.getHeader('Retry-After')).toBe('1');
        });

        it('should refuse a key reused for a different request without scheduling work', async () => {
            reserve.mockResolvedValue({ outcome: 'mismatch' });

            await broadcast();

            expect(controller.create).not.toHaveBeenCalled();
            expect(res.statusCode).toBe(StatusCodes.UNPROCESSABLE_ENTITY);
        });

        it('should release the key when the broadcast fails to start', async () => {
            const err = new Error('Cosmos unavailable');

            reserve.mockResolvedValue({ outcome: 'reserved' });
            controller.create.mockRejectedValue(err);

            await expect(broadcast()).resolves.toBe(err);

            expect(release).toHaveBeenCalledExactlyOnceWith(reservation);
            expect(accept).not.toHaveBeenCalled();
            expect(stopKeepAlive).toHaveBeenCalledOnce();
        });

        it('should surface the original failure when releasing the key fails too', async () => {
            const err = new Error('Cosmos unavailable');

            reserve.mockResolvedValue({ outcome: 'reserved' });
            controller.create.mockRejectedValue(err);
            release.mockRejectedValue(new Error('Redis unavailable'));

            await expect(broadcast()).resolves.toBe(err);
            expect(log.warn).toHaveBeenCalledOnce();
        });

        it.each([
            ['rejects', () => accept.mockRejectedValue(new Error('Redis unavailable'))],
            ['finds the key lapsed', () => accept.mockResolvedValue(false)],
        ])('should log rather than fail when accepting the key %s', async (_label, arrange) => {
            reserve.mockResolvedValue({ outcome: 'reserved' });
            arrange();

            await broadcast();
            await settle();

            expect(res.statusCode).toBe(StatusCodes.ACCEPTED);
            expect(res.getHeader('Destiny-Ghost-Postmaster')).toBe('op-new');
            expect(log.warn).toHaveBeenCalledOnce();
            expect(stopKeepAlive).toHaveBeenCalledOnce();
        });
    });

    describe('GET /broadcasts/:claimCheck', () => {
        const progress = (url = '/broadcasts/op-1') =>
            new Promise(resolve => {
                res.on('end', resolve);
                router(createRequest({ method: 'GET', url }), res, resolve);
            });

        it("should report the broadcast's progress", async () => {
            const broadcast = {
                state: 'active',
                queued: 100,
                duplicates: 2,
                done: false,
                attemptsMade: 0,
                failedReason: undefined,
            };

            controller.getBroadcast.mockResolvedValue(broadcast);

            await progress();

            expect(controller.getBroadcast).toHaveBeenCalledExactlyOnceWith('op-1');
            expect(res.statusCode).toBe(StatusCodes.OK);
            expect(res._getJSONData()).toEqual({
                state: 'active',
                queued: 100,
                duplicates: 2,
                done: false,
                attemptsMade: 0,
            });
        });

        it('should 404 a broadcast that does not exist or has expired', async () => {
            controller.getBroadcast.mockResolvedValue(undefined);

            await progress();

            expect(res.statusCode).toBe(StatusCodes.NOT_FOUND);
        });
    });
});
