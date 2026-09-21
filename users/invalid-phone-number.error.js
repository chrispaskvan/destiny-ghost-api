// @ts-check
/**
 * Represents a phone number that cannot be used: unparseable, or from a region
 * the service does not deliver to.
 *
 * A distinct type rather than a bare `Error` so the sign-up route can answer it
 * as a rejected request without matching on the message text, which would
 * silently revert to a 500 the moment that wording changed.
 */
class InvalidPhoneNumberError extends Error {
    /**
     * @param {string} message
     * @param {{ cause?: unknown }} [options]
     */
    constructor(message, options) {
        super(message);

        this.name = 'InvalidPhoneNumberError';

        if (options?.cause) {
            this.cause = options.cause;
        }
    }
}

export default InvalidPhoneNumberError;
