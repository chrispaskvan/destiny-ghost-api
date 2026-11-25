import { describe, expect, it, vi } from 'vitest';
import { RateLimiterRes } from 'rate-limiter-flexible';
import spendPoint from './spend-point.js';

describe('spendPoint', () => {
    it('spends a point and says so', async () => {
        const limiter = { consume: vi.fn().mockResolvedValue(new RateLimiterRes(4, 1000)) };

        await expect(spendPoint(limiter, 'key')).resolves.toBe(true);
        expect(limiter.consume).toHaveBeenCalledExactlyOnceWith('key');
    });

    it('says no once the limit is spent', async () => {
        const limiter = { consume: vi.fn().mockRejectedValue(new RateLimiterRes(0, 1000)) };

        await expect(spendPoint(limiter, 'key')).resolves.toBe(false);
    });

    it("throws when Redis can't answer", async () => {
        const err = new Error('READONLY');
        const limiter = { consume: vi.fn().mockRejectedValue(err) };

        await expect(spendPoint(limiter, 'key')).rejects.toBe(err);
    });
});
