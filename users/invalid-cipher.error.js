// @ts-check
/**
 * A verification code that does not check out: no such user, an expired
 * token, or a code that doesn't match.
 *
 * A distinct type so the cryptarch route can answer it as 404 "Invalid
 * cipher" and let anything else - a Cosmos outage or throttle - surface as a
 * 500. Answering those as a wrong code sent the user to request, and pay
 * for, another one.
 */
class InvalidCipherError extends Error {
    /**
     * @param {string} message
     */
    constructor(message) {
        super(message);

        this.name = 'InvalidCipherError';
    }
}

export default InvalidCipherError;
