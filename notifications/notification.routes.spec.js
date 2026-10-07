import { EventEmitter } from 'node:events';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { StatusCodes } from 'http-status-codes';
import { createRequest, createResponse } from 'node-mocks-http';
import { accept, release, reserve } from '../helpers/idempotency-keys.js';
import log from '../helpers/log.js';
import NotificationRouter from './notification.routes.js';

const { controller } = vi.hoisted(() => ({
    controller: { create: vi.fn(), getClaimCheck: vi.fn() },
}));

vi.mock('@paralleldrive/cuid2', () => ({ createId: () => 'op-new' }));
vi.mock('../helpers/idempotency-keys.js', () => ({
    accept: vi.fn(),
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

describe('NotificationRouter', () => {
    let router;
    let res;

    beforeEach(() => {
        vi.clearAllMocks();
        router = NotificationRouter({});
        res = createResponse({ eventEmitter: EventEmitter });
        accept.mockResolvedValue(true);
        release.mockResolvedValue(true);
        controller.create.mockResolvedValue('op-new');
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

        it('should reserve the key before starting the broadcast, then accept it', async () => {
            reserve.mockResolvedValue({ outcome: 'reserved' });

            await broadcast();

            expect(reserve).toHaveBeenCalledExactlyOnceWith(reservation);
            expect(controller.create).toHaveBeenCalledExactlyOnceWith('Xur', {
                operationId: 'op-new',
            });
            expect(reserve.mock.invocationCallOrder[0]).toBeLessThan(
                controller.create.mock.invocationCallOrder[0],
            );
            expect(accept).toHaveBeenCalledExactlyOnceWith(reservation);
            expect(res.statusCode).toBe(StatusCodes.ACCEPTED);
            expect(res.getHeader('Destiny-Ghost-Postmaster')).toBe('op-new');
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
        ])(
            'should still answer 202 when accepting the key %s, since the broadcast has started',
            async (_label, arrange) => {
                reserve.mockResolvedValue({ outcome: 'reserved' });
                arrange();

                await broadcast();

                expect(res.statusCode).toBe(StatusCodes.ACCEPTED);
                expect(res.getHeader('Destiny-Ghost-Postmaster')).toBe('op-new');
                expect(log.warn).toHaveBeenCalledOnce();
            },
        );
    });
});
