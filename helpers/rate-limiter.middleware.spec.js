import { describe, it, expect, vi, beforeEach } from 'vitest';
import { StatusCodes } from 'http-status-codes';

const { consume } = vi.hoisted(() => ({ consume: vi.fn() }));

vi.mock('rate-limiter-flexible', () => ({
    RateLimiterRedis: class {
        consume = consume;
    },
}));
vi.mock('./cache.js', () => ({
    default: { isReady: true },
}));

import cache from './cache.js';
import rateLimiterMiddleware from './rate-limiter.middleware.js';

describe('rateLimiterMiddleware', () => {
    let req, res, next;

    beforeEach(() => {
        vi.clearAllMocks();
        cache.isReady = true;
        req = { ip: '127.0.0.1', session: {} };
        res = { set: vi.fn(), status: vi.fn().mockReturnThis(), end: vi.fn() };
        next = vi.fn();
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
        consume.mockRejectedValue({ remainingPoints: 0, msBeforeNext: 1000 });
        cache.isReady = true;

        rateLimiterMiddleware(req, res, next);
        await new Promise(resolve => setImmediate(resolve));

        expect(res.status).toHaveBeenCalledWith(StatusCodes.TOO_MANY_REQUESTS);
        expect(res.end).toHaveBeenCalled();
        expect(next).not.toHaveBeenCalled();
    });

    it('should fail open and call next when Redis is not ready', async () => {
        consume.mockRejectedValue(new Error('connection lost'));
        cache.isReady = false;

        rateLimiterMiddleware(req, res, next);
        await new Promise(resolve => setImmediate(resolve));

        expect(next).toHaveBeenCalled();
        expect(res.status).not.toHaveBeenCalled();
    });
});
