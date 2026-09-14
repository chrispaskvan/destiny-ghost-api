// @ts-check
/**
 * Destiny Error Class
 */
class DestinyError extends Error {
    /**
     * Create a new error from an error response to a Destiny web API request.
     *
     * @param {number} code
     * @param {string} message
     * @param {string} status
     */
    constructor(code, message, status) {
        super(message);

        this.code = code;
        this.name = 'DestinyError';
        this.status = status;
    }
}

export default DestinyError;
