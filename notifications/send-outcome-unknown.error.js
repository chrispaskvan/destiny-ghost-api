// @ts-check
/**
 * A send Twilio may or may not have taken (#719): the request went out, and
 * what came back - a timeout, a dropped connection, a 5xx - does not say
 * which. Thrown so BullMQ tries the job again, and the next attempt looks the
 * message up before it decides whether to send.
 */
class SendOutcomeUnknownError extends Error {
    /**
     * @param {string} message
     * @param {{ cause?: unknown }} [options]
     */
    constructor(message, options) {
        super(message, options);

        Object.assign(this, {
            name: 'SendOutcomeUnknownError',
        });
    }
}

export default SendOutcomeUnknownError;
