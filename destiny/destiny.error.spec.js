import { describe, expect, it } from 'vitest';
import DestinyError from './destiny.error.js';
import { isTransientError } from '../helpers/retry.js';

describe('DestinyError', () => {
    it('should keep the code, message and status Bungie sent', () => {
        const err = new DestinyError(1627, 'Vendor not found', 'DestinyVendorNotFound');

        expect(err).toMatchObject({
            code: 1627,
            message: 'Vendor not found',
            name: 'DestinyError',
            status: 'DestinyVendorNotFound',
        });
        expect(err).not.toHaveProperty('cause');
    });

    /**
     * Bungie answers maintenance with HTTP 200 and SystemDisabled in the
     * body, so nothing below this error ever saw a failure to retry.
     */
    it('should be transient when Bungie reports SystemDisabled', () => {
        const err = new DestinyError(5, 'Down for maintenance', 'SystemDisabled');

        expect(err.retryable).toBe(true);
        expect(isTransientError(err)).toBe(true);
    });

    /**
     * Throttling comes back the same way, and asks for exactly what a retry
     * after backoff does: the same request, later.
     */
    it.each([
        [31, 'ThrottleLimitExceeded'],
        [35, 'ThrottleLimitExceededMinutes'],
        [36, 'ThrottleLimitExceededMomentarily'],
        [37, 'ThrottleLimitExceededSeconds'],
        [51, 'PerEndpointRequestThrottleExceeded'],
        [54, 'PerApplicationThrottleExceeded'],
        [55, 'PerApplicationAnonymousThrottleExceeded'],
        [56, 'PerApplicationAuthenticatedThrottleExceeded'],
        [57, 'PerUserThrottleExceeded'],
        [1672, 'DestinyThrottledByGameServer'],
    ])('should be transient when Bungie reports %i (%s)', (code, status) => {
        expect(isTransientError(new DestinyError(code, 'Slow down', status))).toBe(true);
    });

    it.each([
        [-1, ''],
        [302, 'MessagingSendThrottle'],
        [2004, 'TokenThrottling'],
        [7, 'ParameterParseFailure'],
        [1601, 'DestinyAccountNotFound'],
        [1627, 'DestinyVendorNotFound'],
    ])('should be permanent for code %i', (code, status) => {
        expect(isTransientError(new DestinyError(code, 'No', status))).toBe(false);
    });

    it('should be transient when marked retryable', () => {
        const cause = Object.assign(new Error('socket hang up'), { code: 'ECONNRESET' });
        const err = new DestinyError(-1, 'Failed', '', { cause, retryable: true });

        expect(err.cause).toBe(cause);
        expect(isTransientError(err)).toBe(true);
    });
});
