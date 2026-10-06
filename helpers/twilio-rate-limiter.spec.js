import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { RateLimiterMemory } from 'rate-limiter-flexible';
import client from './cache.js';
import { createScheduler } from './twilio-rate-limiter.js';

// Recorded at import time; `clearMocks` would wipe the calls of a vi.fn() constructor.
const redisLimiterOptions = vi.hoisted(() => []);

vi.mock('./cache.js', () => ({ default: {} }));
vi.mock('rate-limiter-flexible', async importOriginal => ({
    ...(await importOriginal()),
    RateLimiterRedis: class {
        constructor(options) {
            redisLimiterOptions.push(options);
        }
    },
}));

describe('Twilio send rate limiter', () => {
    it('keeps its bucket on the cache client, through the node-redis code path', () => {
        expect(redisLimiterOptions).toEqual([
            {
                storeClient: client,
                useRedisPackage: true,
                keyPrefix: 'twilio-send',
                points: 4,
                duration: 1,
            },
        ]);
    });
});

describe('createScheduler', () => {
    beforeEach(() => {
        vi.useFakeTimers();
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    it('runs the scheduled function and resolves with its result', async () => {
        const scheduler = createScheduler(new RateLimiterMemory({ points: 1, duration: 1 }));

        await expect(scheduler.schedule(async () => 'sent')).resolves.toBe('sent');
    });

    it('holds a function until the next window once the points are spent', async () => {
        const scheduler = createScheduler(new RateLimiterMemory({ points: 1, duration: 1 }));
        const first = vi.fn(async () => 'first');
        const second = vi.fn(async () => 'second');

        await scheduler.schedule(first);
        const pending = scheduler.schedule(second);
        await vi.advanceTimersByTimeAsync(900);

        expect(second).not.toHaveBeenCalled();

        await vi.advanceTimersByTimeAsync(200);

        await expect(pending).resolves.toBe('second');
        expect(second).toHaveBeenCalledTimes(1);
    });

    it('rejects without running the function when the store fails', async () => {
        const err = new Error('Connection to the cache failed.');
        const scheduler = createScheduler(
            /** @type {*} */ ({ points: 4, consume: vi.fn().mockRejectedValue(err) }),
        );
        const fn = vi.fn();

        await expect(scheduler.schedule(fn)).rejects.toBe(err);
        expect(fn).not.toHaveBeenCalled();
    });
});
