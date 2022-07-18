/**
 * Destiny Error Class
 */
class RequestError extends Error {
    /**
     * Create a new error from an error response to a Destiny web API request.
     */
    constructor({ response: { data, status, statusText } }) {
        super();

        Object.assign(this, {
            data,
            name: 'RequestError',
            status,
            statusText,
        });
    }
}

export default RequestError;
