/**
 * Destiny Error Class
 */
class DestinyError extends Error {
    /**
     * Create a new error from an error response to a Destiny web API request.
     *
     * @param code
     * @param message
     * @param status
     */
    constructor(code, message, status) {
        super(message);

        Object.assign(this, {
            code,
            name: 'DestinyError',
            status,
        });
    }
}

module.exports = DestinyError;
