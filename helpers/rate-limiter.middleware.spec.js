import { describe, it, expect, vi, beforeEach } from 'vitest';
import { StatusCodes } from 'http-status-codes';

const { consume, senderConsume, MockRateLimiterRes } = vi.hoisted(() => ({
    consume: vi.fn(),
    senderConsume: vi.fn(),
    MockRateLimiterRes: class RateLimiterRes {
        constructor(remainingPoints, msBeforeNext) {
            this.remainingPoints = remainingPoints;
            this.msBeforeNext = msBeforeNext;
        }
    },
}));

vi.mock('rate-limiter-flexible', () => ({
    RateLimiterRedis: class {
        constructor({ points, keyPrefix }) {
            this.points = points;
            this.consume = {
                austringer: consume,
                'twilio-sender': senderConsume,
            }[keyPrefix];
        }
    },
    RateLimiterRes: MockRateLimiterRes,
}));
vi.mock('./cache.js', () => ({
    default: { isReady: true },
}));

import cache from './cache.js';
import rateLimiterMiddleware, { twilioRateLimiterMiddleware } from './rate-limiter.middleware.js';

describe('rateLimiterMiddleware', () => {
    let req, res, next;

    beforeEach(() => {
        vi.clearAllMocks();
        cache.isReady = true;
        req = { ip: '127.0.0.1', session: {}, headers: {} };
        res = {
            set: vi.fn(),
            removeHeader: vi.fn(),
            status: vi.fn().mockReturnThis(),
            end: vi.fn(),
        };
        next = vi.fn();
    });

    it.each([
        ['POST', '/users'],
        ['GET', '/destiny2'],
    ])('keeps the global IP limit for %s %s', async (method, path) => {
        Object.assign(req, { method, path });
        consume.mockResolvedValue({ remainingPoints: 90, msBeforeNext: 1000 });

        await rateLimiterMiddleware(req, res, next);

        expect(consume).toHaveBeenCalledExactlyOnceWith(req.ip, 10);
    });

    it('preserves the registered browser membership bucket', async () => {
        req.session = { membershipId: 'member-id', dateRegistered: '2026-09-19' };
        consume.mockResolvedValue({ remainingPoints: 99, msBeforeNext: 1000 });

        await rateLimiterMiddleware(req, res, next);

        expect(consume).toHaveBeenCalledExactlyOnceWith('member-id', 1);
    });

    it('isolates signed senders sharing an IP and reuses a repeat sender bucket', async () => {
        senderConsume.mockResolvedValue({ remainingPoints: 19, msBeforeNext: 60000 });
        req.session = { membershipId: 'browser-member' };

        for (const sender of ['+15005550006', '+15005550007', '+15005550006']) {
            req.body = { From: sender };
            await twilioRateLimiterMiddleware(req, res, next);
        }

        expect(senderConsume.mock.calls).toEqual([
            ['+15005550006', 1],
            ['+15005550007', 1],
            ['+15005550006', 1],
        ]);
        expect(res.set).toHaveBeenCalledWith(expect.objectContaining({ 'X-RateLimit-Limit': 20 }));
        expect(consume).not.toHaveBeenCalled();
        expect(req.session).toEqual({ membershipId: 'browser-member' });
    });

    it('delegates an exhausted sender quota to its webhook response policy', async () => {
        senderConsume.mockRejectedValueOnce(new MockRateLimiterRes(0, 59001));
        req.body = { From: '+15005550006' };
        const onLimit = vi.fn();

        await twilioRateLimiterMiddleware(req, res, next, onLimit);

        expect(onLimit).toHaveBeenCalledExactlyOnceWith();
        expect(res.status).not.toHaveBeenCalled();
        expect(res.set).not.toHaveBeenCalledWith('Retry-After', expect.anything());
        expect(res.set).toHaveBeenCalledWith(expect.objectContaining({ 'X-RateLimit-Limit': 20 }));
        expect(next).not.toHaveBeenCalled();
    });

    it('should call next and set rate-limit headers when under the limit', async () => {
        consume.mockResolvedValue({ remainingPoints: 99, msBeforeNext: 1000 });

        rateLimiterMiddleware(req, res, next);
        await new Promise(resolve => setImmediate(resolve));

        expect(res.set).toHaveBeenCalledWith(
            expect.objectContaining({ 'X-RateLimit-Remaining': 99 }),
        );
        expect(next).toHaveBeenCalled();
        expect(res.status).not.toHaveBeenCalled();
    });

    it('should respond 429 when the limit is exceeded and Redis is ready', async () => {
        consume.mockRejectedValue(new MockRateLimiterRes(0, 1000));
        cache.isReady = true;

        rateLimiterMiddleware(req, res, next);
        await new Promise(resolve => setImmediate(resolve));

        expect(res.status).toHaveBeenCalledWith(StatusCodes.TOO_MANY_REQUESTS);
        expect(res.end).toHaveBeenCalled();
        expect(next).not.toHaveBeenCalled();
    });

    it('should fail open and call next when Redis is not ready', async () => {
        consume.mockRejectedValue(new MockRateLimiterRes(0, 1000));
        cache.isReady = false;

        rateLimiterMiddleware(req, res, next);
        await new Promise(resolve => setImmediate(resolve));

        expect(next).toHaveBeenCalled();
        expect(res.status).not.toHaveBeenCalled();
        expect(consume).not.toHaveBeenCalled();
    });

    it('should fail open and call next when the backend rejects with a plain Error while Redis is ready', async () => {
        consume.mockRejectedValue(new Error('connection lost'));
        cache.isReady = true;

        rateLimiterMiddleware(req, res, next);
        await new Promise(resolve => setImmediate(resolve));

        expect(next).toHaveBeenCalled();
        expect(res.status).not.toHaveBeenCalled();
        expect(res.set).not.toHaveBeenCalled();
    });
});
