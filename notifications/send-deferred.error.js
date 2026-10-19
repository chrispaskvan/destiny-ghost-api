// @ts-check
/**
 * A send held back because it could not be recorded first (#719): nothing
 * went to Twilio. Thrown so BullMQ tries the job again later, where the
 * record's Redis may be back. Marked `retryable`, which `isTransientError`
 * honours, so no caller makes it permanent.
 *
 * Distinct from `SendOutcomeUnknownError`, which means Twilio may have the
 * message: a job that gives up on this one sent nothing, and nobody needs to
 * go and check.
 */
class SendDeferredError extends Error {
    /**
     * @param {string} message
     * @param {{ cause?: unknown }} [options]
     */
    constructor(message, options) {
        super(message, options);

        Object.assign(this, {
            name: 'SendDeferredError',
            retryable: true,
        });
    }
}

export default SendDeferredError;
