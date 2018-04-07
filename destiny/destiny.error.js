/**
 * Destiny Error Class
 */
class DestinyError extends Error {
    /**
     * Create a new error from an error response to a Destiny web API request.
     * @param code
     * @param message
     * @param status
     */
    constructor(code, message, status) {
        super();

        Object.assign(this, {
            code: code,
            message: message,
            name: 'DestinyError',
            status: status
        });
    }
}

module.exports = DestinyError;
