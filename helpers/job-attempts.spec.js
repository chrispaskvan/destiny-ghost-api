import { describe, expect, it } from 'vitest';
import { isExhausted, isLastAttempt } from './job-attempts.js';

const job = (attemptsMade, attempts) => ({
    attemptsMade,
    opts: attempts === undefined ? {} : { attempts },
});

describe('isExhausted', () => {
    it('should say a job with failed attempts to spare is not exhausted', () => {
        expect(isExhausted(job(2, 3))).toBe(false);
    });

    it('should say a job that failed every attempt is exhausted', () => {
        expect(isExhausted(job(3, 3))).toBe(true);
    });

    it('should allow a job with no attempts of its own one try, as BullMQ does', () => {
        expect(isExhausted(job(0))).toBe(false);
        expect(isExhausted(job(1))).toBe(true);
    });
});

describe('isLastAttempt', () => {
    it('should say an attempt with more to follow is not the last', () => {
        expect(isLastAttempt(job(1, 3))).toBe(false);
    });

    it('should say the final attempt is the last', () => {
        expect(isLastAttempt(job(2, 3))).toBe(true);
    });

    it('should say the only attempt of a job with none of its own is the last', () => {
        expect(isLastAttempt(job(0))).toBe(true);
    });
});
