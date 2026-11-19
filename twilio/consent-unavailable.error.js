// @ts-check
import RetryableError from '../notifications/retryable.error.js';

/**
 * Consent could not be read, so the work waits rather than going ahead or
 * being dropped: thrown so BullMQ tries the job again once the store is back.
 */
class ConsentUnavailableError extends RetryableError {}

export default ConsentUnavailableError;
