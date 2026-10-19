// @ts-check
import RetryableError from './retryable.error.js';

/**
 * A send held back because it could not be recorded first (#719): nothing
 * went to Twilio. Thrown so BullMQ tries the job again later, where the
 * record's Redis may be back.
 *
 * Distinct from `SendOutcomeUnknownError`, which means Twilio may have the
 * message: a job that gives up on this one sent nothing, and nobody needs to
 * go and check.
 */
class SendDeferredError extends RetryableError {}

export default SendDeferredError;
