/**
 * Xur Unavailable Error Class
 *
 * Represents a business-logic error when Xur inventory
 * cannot be retrieved (e.g., vendor not present in-game).
 */
class XurUnavailableError extends Error {
    constructor(message, options) {
        super(message, options);

        Object.assign(this, {
            name: 'XurUnavailableError',
        });
    }
}

export default XurUnavailableError;
