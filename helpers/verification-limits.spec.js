import { beforeEach, describe, expect, it, vi } from 'vitest';

const { destinationConsume, textsConsume, limiterOptions, MockRateLimiterRes } = vi.hoisted(() => ({
    // Recorded at import time; `clearMocks` would wipe the calls of a vi.fn() constructor.
    limiterOptions: [],
    destinationConsume: vi.fn(),
    textsConsume: vi.fn(),
    MockRateLimiterRes: class RateLimiterRes {},
}));

vi.mock('rate-limiter-flexible', () => ({
    RateLimiterRedis: class {
        constructor(options) {
            limiterOptions.push(options);
            this.consume = {
                'verification-destination': destinationConsume,
                'verification-texts': textsConsume,
            }[options.keyPrefix];
        }
    },
    RateLimiterRes: MockRateLimiterRes,
}));
vi.mock('./cache.js', () => ({
    default: { isReady: true },
}));
vi.mock('./log.js', () => ({
    default: { error: vi.fn(), info: vi.fn(), warn: vi.fn() },
}));

import cache from './cache.js';
import log from './log.js';
import allowVerification, {
    PER_DESTINATION_PER_DAY,
    TEXTS_PER_HOUR,
} from './verification-limits.js';

beforeEach(() => {
    cache.isReady = true;
    destinationConsume.mockResolvedValue({});
    textsConsume.mockResolvedValue({});
});

describe('verification limits', () => {
    it('keeps both buckets on the cache client, through the node-redis code path', () => {
        expect(limiterOptions).toEqual([
            expect.objectContaining({
                keyPrefix: 'verification-destination',
                points: PER_DESTINATION_PER_DAY,
                duration: 86_400,
                storeClient: cache,
                useRedisPackage: true,
            }),
            expect.objectContaining({
                keyPrefix: 'verification-texts',
                points: TEXTS_PER_HOUR,
                duration: 3_600,
                storeClient: cache,
                useRedisPackage: true,
            }),
        ]);
    });

    it('allows 5 messages a day to a destination and 50 texts an hour in all', () => {
        expect([PER_DESTINATION_PER_DAY, TEXTS_PER_HOUR]).toEqual([5, 50]);
    });

    it('charges a text to its number and to the service', async () => {
        await expect(allowVerification('phone', '+12085550123')).resolves.toBe(true);

        expect(destinationConsume).toHaveBeenCalledWith('phone:+12085550123');
        expect(textsConsume).toHaveBeenCalledWith('all');
    });

    /**
     * Email is cheap enough that only the destination needs protecting; a
     * shared cap on it would let a flood of addresses lock out real ones.
     */
    it('charges an email to its address alone, whatever its case', async () => {
        await expect(allowVerification('email', 'Guardian@Example.com')).resolves.toBe(true);

        expect(destinationConsume).toHaveBeenCalledWith('email:guardian@example.com');
        expect(textsConsume).not.toHaveBeenCalled();
    });

    it("withholds a message once its destination's share is spent", async () => {
        destinationConsume.mockRejectedValue(new MockRateLimiterRes());

        await expect(allowVerification('phone', '+12085550123')).resolves.toBe(false);

        expect(textsConsume).not.toHaveBeenCalled();
        expect(log.warn).toHaveBeenCalled();
    });

    it("withholds a text, as an error to alert on, once the service's hour is spent", async () => {
        textsConsume.mockRejectedValue(new MockRateLimiterRes());

        await expect(allowVerification('phone', '+12085550123')).resolves.toBe(false);

        expect(log.error).toHaveBeenCalledWith(
            { limit: TEXTS_PER_HOUR },
            expect.stringContaining('hourly limit'),
        );
    });

    it('fails closed when Redis is not ready, without queueing a command', async () => {
        cache.isReady = false;

        await expect(allowVerification('phone', '+12085550123')).resolves.toBe(false);

        expect(destinationConsume).not.toHaveBeenCalled();
    });

    it('fails closed when Redis rejects a command', async () => {
        const err = new Error('READONLY');

        destinationConsume.mockRejectedValue(err);

        await expect(allowVerification('email', 'guardian@example.com')).resolves.toBe(false);

        expect(log.error).toHaveBeenCalledWith(
            { err, channel: 'email' },
            expect.stringContaining('Unable to check'),
        );
    });
});
