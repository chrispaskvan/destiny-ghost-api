import {
    describe, expect, it, beforeEach, afterEach, vi,
} from 'vitest';
import ClaimCheck, { claimCheckExpiration } from './claim-check';
import cache from './cache';

vi.mock('./cache', () => ({
    default: {
        hset: vi.fn(),
        hget: vi.fn(),
        hgetall: vi.fn(),
        expire: vi.fn(),
    },
}));
vi.mock('@paralleldrive/cuid2', () => ({
    createId: vi.fn(() => 'test-claim-check-id'),
}));

describe('ClaimCheck', () => {
    let claimCheck;

    const testPhoneNumber = '+1234567890';
    const testPhoneNumber2 = '+0987654321';
    const testClaimCheckId = 'test-claim-check-id';
    const status = {
        queued: 'queued',
        processing: 'processing',
        completed: 'completed',
    };

    beforeEach(() => {
        claimCheck = new ClaimCheck();
        vi.clearAllMocks();
    });

    afterEach(() => {
        vi.resetAllMocks();
    });

    describe('constructor and number property', () => {
        it('should create a new instance with a unique claim check number', () => {
            const { number } = claimCheck;

            expect(number).toBe(testClaimCheckId);
            expect(number).toBeTruthy();
            expect(typeof number).toBe('string');
        });

        it('should generate different numbers for different instances', async () => {
            const { createId } = await import('@paralleldrive/cuid2');

            vi.mocked(createId).mockReturnValueOnce('different-id');
            
            const claimCheck2 = new ClaimCheck();
            
            expect(claimCheck.number).toBe(testClaimCheckId);
            expect(claimCheck2.number).toBe('different-id');
        });

        it('should make number property read-only', () => {
            const originalNumber = claimCheck.number;
            
            expect(() => {
                claimCheck.number = 'modified-number';
            }).toThrow();
            expect(claimCheck.number).toBe(originalNumber);
        });
    });

    describe('addPhoneNumber', () => {
        it('should add a phone number with default status "queued"', async () => {
            await claimCheck.addPhoneNumber(testPhoneNumber);
            
            expect(cache.hset).toHaveBeenCalledWith(
                testClaimCheckId,
                testPhoneNumber,
                status.queued
            );
            expect(cache.expire).toHaveBeenCalledWith(testClaimCheckId, claimCheckExpiration);
        });

        it('should add a phone number with custom status', async () => {
            await claimCheck.addPhoneNumber(testPhoneNumber, status.processing);
            
            expect(cache.hset).toHaveBeenCalledWith(
                testClaimCheckId,
                testPhoneNumber,
                status.processing
            );
            expect(cache.expire).toHaveBeenCalledWith(testClaimCheckId, claimCheckExpiration);
        });

        it('should handle multiple phone numbers', async () => {
            await claimCheck.addPhoneNumber(testPhoneNumber, status.queued);
            await claimCheck.addPhoneNumber(testPhoneNumber2, status.processing);
            
            expect(cache.hset).toHaveBeenCalledTimes(2);
            expect(cache.expire).toHaveBeenCalledTimes(2);
            expect(cache.hset).toHaveBeenNthCalledWith(1, testClaimCheckId, testPhoneNumber, status.queued);
            expect(cache.hset).toHaveBeenNthCalledWith(2, testClaimCheckId, testPhoneNumber2, status.processing);
        });

        it('should handle cache errors gracefully', async () => {
            const cacheError = new Error('Cache connection failed');

            vi.mocked(cache.hset).mockRejectedValueOnce(cacheError);
            
            await expect(claimCheck.addPhoneNumber(testPhoneNumber)).rejects.toThrow('Cache connection failed');
        });
    });

    describe('getClaimCheck (static method)', () => {
        it('should retrieve all phone numbers for a claim check', async () => {
            const expectedData = {
                [testPhoneNumber]: status.queued,
                [testPhoneNumber2]: status.processing,
            };
            vi.mocked(cache.hgetall).mockResolvedValueOnce(expectedData);
            
            const result = await ClaimCheck.getClaimCheck(testClaimCheckId);
            
            expect(cache.hgetall).toHaveBeenCalledWith(testClaimCheckId);
            expect(result).toEqual(expectedData);
        });

        it('should return empty object when claim check does not exist', async () => {
            const claimCheckNumber = 'non-existent-id';
            vi.mocked(cache.hgetall).mockResolvedValueOnce({});
            
            const result = await ClaimCheck.getClaimCheck(claimCheckNumber);
            
            expect(cache.hgetall).toHaveBeenCalledWith(claimCheckNumber);
            expect(result).toEqual({});
        });

        it('should handle cache errors gracefully', async () => {
            const cacheError = new Error('Cache read failed');
            vi.mocked(cache.hgetall).mockRejectedValueOnce(cacheError);
            
            await expect(ClaimCheck.getClaimCheck(testClaimCheckId)).rejects.toThrow('Cache read failed');
        });
    });

    describe('updatePhoneNumber (static method)', () => {
        it('should update phone number status when it exists', async () => {
            const existingStatus = status.processing;
            
            vi.mocked(cache.hget).mockResolvedValueOnce(existingStatus);
            
            const result = await ClaimCheck.updatePhoneNumber(testClaimCheckId, testPhoneNumber, status.completed);
            
            expect(cache.hget).toHaveBeenCalledWith(testClaimCheckId, testPhoneNumber);
            expect(cache.hset).toHaveBeenCalledWith(testClaimCheckId, testPhoneNumber, status.completed);
            expect(result).toBe(existingStatus);
        });

        it('should not update when phone number does not exist', async () => {
            vi.mocked(cache.hget).mockResolvedValueOnce(null);
            
            const result = await ClaimCheck.updatePhoneNumber(testClaimCheckId, testPhoneNumber, status.completed);
            
            expect(cache.hget).toHaveBeenCalledWith(testClaimCheckId, testPhoneNumber);
            expect(cache.hset).not.toHaveBeenCalled();
            expect(result).toBeNull();
        });

        it('should not update when phone number returns undefined', async () => {
            vi.mocked(cache.hget).mockResolvedValueOnce(undefined);
            
            const result = await ClaimCheck.updatePhoneNumber(testClaimCheckId, testPhoneNumber, status.completed);
            
            expect(cache.hget).toHaveBeenCalledWith(testClaimCheckId, testPhoneNumber);
            expect(cache.hset).not.toHaveBeenCalled();
            expect(result).toBeUndefined();
        });

        it('should handle empty string as falsy value', async () => {
            vi.mocked(cache.hget).mockResolvedValueOnce('');
            
            const result = await ClaimCheck.updatePhoneNumber(testClaimCheckId, testPhoneNumber, status.completed);
            
            expect(cache.hget).toHaveBeenCalledWith(testClaimCheckId, testPhoneNumber);
            expect(cache.hset).not.toHaveBeenCalled();
            expect(result).toBe('');
        });

        it('should handle cache read errors gracefully', async () => {
            const cacheError = new Error('Cache read failed');
            
            vi.mocked(cache.hget).mockRejectedValueOnce(cacheError);
            
            await expect(
                ClaimCheck.updatePhoneNumber(testClaimCheckId, testPhoneNumber, status.completed)
            ).rejects.toThrow('Cache read failed');
        });

        it('should handle cache write errors gracefully', async () => {
            const existingStatus = status.processing;
            const cacheError = new Error('Cache write failed');
            
            vi.mocked(cache.hget).mockResolvedValueOnce(existingStatus);
            vi.mocked(cache.hset).mockRejectedValueOnce(cacheError);
            
            await expect(
                ClaimCheck.updatePhoneNumber(testClaimCheckId, testPhoneNumber, status.completed)
            ).rejects.toThrow('Cache write failed');
        });
    });

    describe('integration scenarios', () => {
        it('should handle a complete workflow', async () => {
            const claimCheckNumber = claimCheck.number;
            
            await claimCheck.addPhoneNumber(testPhoneNumber, status.queued);            
            vi.mocked(cache.hgetall).mockResolvedValueOnce({
                [testPhoneNumber]: status.queued,
            });
            
            const claimCheckData = await ClaimCheck.getClaimCheck(claimCheckNumber);

            expect(claimCheckData[testPhoneNumber]).toBe(status.queued);
            
            vi.mocked(cache.hget).mockResolvedValueOnce(status.queued);
            const oldStatus = await ClaimCheck.updatePhoneNumber(
                claimCheckNumber,
                testPhoneNumber,
                status.completed
            );
            
            expect(oldStatus).toBe(status.queued);
            expect(cache.hset).toHaveBeenLastCalledWith(
                claimCheckNumber,
                testPhoneNumber,
                status.completed
            );
        });

        it('should handle expiration setting correctly', async () => {
            await claimCheck.addPhoneNumber(testPhoneNumber);
            
            // Verify expiration is set to 1 day (86400 seconds)
            expect(cache.expire).toHaveBeenCalledWith(testClaimCheckId, claimCheckExpiration);
        });
    });
});
