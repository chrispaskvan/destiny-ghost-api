import { describe, it, expect, beforeEach, vi } from 'vitest';
import cache from './cache';
import { getIdempotencyKey, setIdempotencyKey } from './idempotency-keys';

vi.mock('./cache');

describe('idempotency-keys', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    describe('getIdempotencyKey', () => {
        it('should throw an error if idempotencyKey is not a string', async () => {
            await expect(getIdempotencyKey(null)).rejects.toThrow();
            await expect(getIdempotencyKey(123)).rejects.toThrow();
        });

        it('should return the value from cache', async () => {
            const idempotencyKey = 'test-key';
            const value = 'test-value';

            cache.get.mockResolvedValue(value);

            const result = await getIdempotencyKey(idempotencyKey);

            expect(cache.get).toHaveBeenCalledWith(idempotencyKey);
            expect(result).toBe(value);
        });
    });

    describe('setIdempotencyKey', () => {
        it('should throw an error if idempotencyKey is not a string', async () => {
            await expect(setIdempotencyKey(null, 'claim-check')).rejects.toThrow();
            await expect(setIdempotencyKey(123, 'claim-check')).rejects.toThrow();
        });

        it('should throw an error if claimCheckNumber is not a string', async () => {
            await expect(setIdempotencyKey('test-key', null)).rejects.toThrow();
            await expect(setIdempotencyKey('test-key', 123)).rejects.toThrow();
        });

        it('should set the value in cache and set expiration', async () => {
            const idempotencyKey = 'test-key';
            const claimCheckNumber = 'claim-check';

            cache.set.mockResolvedValue();
            cache.expire.mockResolvedValue(true);

            const result = await setIdempotencyKey(idempotencyKey, claimCheckNumber);

            expect(cache.set).toHaveBeenCalledWith(idempotencyKey, claimCheckNumber);
            expect(cache.expire).toHaveBeenCalledWith(idempotencyKey, 86400);
            expect(result).toBe(true);
        });
    });
});
