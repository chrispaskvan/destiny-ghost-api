const TRANSIENT_STATUS_CODES = new Set([429, 500, 502, 503, 504]);

/**
 * Destiny Error Class
 */
class ResponseError extends Error {
    /**
     * Create a new error from an error response to a Destiny web API request.
     */
    constructor({ response: { data, status, statusText } }) {
        super();

        Object.assign(this, {
            data,
            isTransient: TRANSIENT_STATUS_CODES.has(status),
            name: 'RequestError',
            status,
            statusText,
        });
    }
}

export default ResponseError;
