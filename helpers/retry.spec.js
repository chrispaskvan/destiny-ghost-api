import {
    afterEach, beforeEach, describe, expect, test, vi,
} from 'vitest';
import { getBackoffDelay, isTransientError, isTransientSmtpError, withRetry } from './retry.js';

vi.mock('./log.js', () => ({
    default: {
        warn: vi.fn(),
    },
}));

describe('getBackoffDelay', () => {
    test('returns baseDelay range on attempt 0', () => {
        vi.spyOn(Math, 'random').mockReturnValue(0);

        const delay = getBackoffDelay(0, 1000, 15000);

        expect(delay).toBe(1000); // 1000 * 2^0 + 0 jitter
        vi.restoreAllMocks();
    });

    test('doubles delay with each attempt', () => {
        vi.spyOn(Math, 'random').mockReturnValue(0);

        expect(getBackoffDelay(0, 1000, 15000)).toBe(1000);
        expect(getBackoffDelay(1, 1000, 15000)).toBe(2000);
        expect(getBackoffDelay(2, 1000, 15000)).toBe(4000);
        expect(getBackoffDelay(3, 1000, 15000)).toBe(8000);

        vi.restoreAllMocks();
    });

    test('caps at maxDelay', () => {
        vi.spyOn(Math, 'random').mockReturnValue(0);

        const delay = getBackoffDelay(10, 1000, 15000);

        expect(delay).toBe(15000);
        vi.restoreAllMocks();
    });

    test('adds jitter up to baseDelay', () => {
        vi.spyOn(Math, 'random').mockReturnValue(0.5);

        const delay = getBackoffDelay(0, 1000, 15000);

        expect(delay).toBe(1500); // 1000 * 2^0 + 500 jitter
        vi.restoreAllMocks();
    });

    test('jitter does not exceed maxDelay', () => {
        vi.spyOn(Math, 'random').mockReturnValue(1);

        const delay = getBackoffDelay(10, 1000, 15000);

        expect(delay).toBe(15000);
        vi.restoreAllMocks();
    });
});

describe('withRetry', () => {
    beforeEach(() => {
        vi.useFakeTimers();
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    test('returns result on first success', async () => {
        const fn = vi.fn().mockResolvedValue('ok');

        const result = await withRetry(fn);

        expect(result).toBe('ok');
        expect(fn).toHaveBeenCalledTimes(1);
    });

    test('retries on failure and succeeds', async () => {
        const fn = vi.fn()
            .mockRejectedValueOnce(new Error('fail'))
            .mockResolvedValue('ok');

        const promise = withRetry(fn);

        await vi.runAllTimersAsync();

        const result = await promise;

        expect(result).toBe('ok');
        expect(fn).toHaveBeenCalledTimes(2);
    });

    test('throws after exhausting maxRetries', async () => {
        const fn = vi.fn().mockRejectedValue(new Error('always fails'));

        const promise = withRetry(fn, { maxRetries: 2 });
        const assertion = expect(promise).rejects.toThrow('always fails');

        await vi.runAllTimersAsync();
        await assertion;

        expect(fn).toHaveBeenCalledTimes(3); // 1 initial + 2 retries
    });

    test('respects maxRetries option', async () => {
        const fn = vi.fn().mockRejectedValue(new Error('fail'));

        const promise = withRetry(fn, { maxRetries: 1 });
        const assertion = expect(promise).rejects.toThrow('fail');

        await vi.runAllTimersAsync();
        await assertion;

        expect(fn).toHaveBeenCalledTimes(2); // 1 initial + 1 retry
    });

    test('does not retry when shouldRetry returns false', async () => {
        const fn = vi.fn().mockRejectedValue(new Error('permanent'));

        await expect(withRetry(fn, { shouldRetry: () => false }))
            .rejects.toThrow('permanent');

        expect(fn).toHaveBeenCalledTimes(1);
    });

    test('retries when shouldRetry returns true', async () => {
        const fn = vi.fn()
            .mockRejectedValueOnce(new Error('transient'))
            .mockResolvedValue('ok');

        const promise = withRetry(fn, { shouldRetry: () => true });

        await vi.runAllTimersAsync();

        const result = await promise;

        expect(result).toBe('ok');
        expect(fn).toHaveBeenCalledTimes(2);
    });

    test('shouldRetry receives the thrown error', async () => {
        const shouldRetry = vi.fn().mockReturnValue(false);
        const error = new Error('specific');
        const fn = vi.fn().mockRejectedValue(error);

        await expect(withRetry(fn, { shouldRetry })).rejects.toThrow('specific');

        expect(shouldRetry).toHaveBeenCalledWith(error);
    });

    test('propagates the last error when retries are exhausted', async () => {
        const errors = [new Error('first'), new Error('second'), new Error('third')];
        let call = 0;
        const fn = vi.fn().mockImplementation(() => Promise.reject(errors[call++]));

        const promise = withRetry(fn, { maxRetries: 2 });
        const assertion = expect(promise).rejects.toThrow('third');

        await vi.runAllTimersAsync();
        await assertion;
    });
});

describe('isTransientError', () => {
    test('returns true when status is undefined (connection error)', () => {
        expect(isTransientError(new Error('connection failed'))).toBe(true);
    });

    test.each([408, 429, 500, 502, 503, 504])('returns true for status %i', status => {
        const err = Object.assign(new Error(), { status });

        expect(isTransientError(err)).toBe(true);
    });

    test.each([400, 401, 403, 404, 422])('returns false for status %i', status => {
        const err = Object.assign(new Error(), { status });

        expect(isTransientError(err)).toBe(false);
    });
});

describe('isTransientSmtpError', () => {
    test.each(['ETIMEDOUT', 'ESOCKET', 'ECONNECTION', 'EDNS'])('returns true for code %s', code => {
        const err = Object.assign(new Error(), { code });

        expect(isTransientSmtpError(err)).toBe(true);
    });

    test.each(['EAUTH', 'ENOAUTH', 'EENVELOPE'])('returns false for code %s', code => {
        const err = Object.assign(new Error(), { code });

        expect(isTransientSmtpError(err)).toBe(false);
    });

    test.each([421, 450, 451, 452])('returns true for SMTP responseCode %i', responseCode => {
        const err = Object.assign(new Error(), { responseCode });

        expect(isTransientSmtpError(err)).toBe(true);
    });

    test.each([550, 553, 554])('returns false for SMTP responseCode %i', responseCode => {
        const err = Object.assign(new Error(), { responseCode });

        expect(isTransientSmtpError(err)).toBe(false);
    });
});
