// @ts-check
import RetryableError from '../notifications/retryable.error.js';

/**
 * A job's progress could not be saved. Thrown so BullMQ tries the job again,
 * rather than abandoning work it has already done.
 */
class ProgressUnsavedError extends RetryableError {}

export default ProgressUnsavedError;
