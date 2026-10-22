import { describe, expect, it } from 'vitest';
import RetryableError from './retryable.error.js';
import SendDeferredError from './send-deferred.error.js';
import SendOutcomeUnknownError from './send-outcome-unknown.error.js';

describe('RetryableError', () => {
    /**
     * Errors from another copy of the module are matched by name, so each
     * must carry its own, not the base's.
     */
    it.each([
        [SendOutcomeUnknownError, 'SendOutcomeUnknownError'],
        [SendDeferredError, 'SendDeferredError'],
    ])('should name a %o after itself and mark it retryable', (Type, name) => {
        const cause = new Error('down');
        const err = new Type('try later', { cause });

        expect(err).toBeInstanceOf(RetryableError);
        expect(err).toBeInstanceOf(Error);
        expect(err).toMatchObject({ name, retryable: true, message: 'try later', cause });
    });
});
