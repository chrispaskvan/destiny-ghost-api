// @ts-check
/**
 * An error of our own that means "try the job again later" (#719). It marks
 * itself `retryable`, which `isTransientError` honours, so every caller that
 * asks whether to retry gets the same answer without knowing each type, and
 * the worker's catch-all never makes one permanent. Named after the subclass
 * thrown, which is how errors from another copy of the module are matched.
 */
class RetryableError extends Error {
    /**
     * @param {string} message
     * @param {{ cause?: unknown }} [options]
     */
    constructor(message, options) {
        super(message, options);

        Object.assign(this, {
            name: new.target.name,
            retryable: true,
        });
    }
}

export default RetryableError;
