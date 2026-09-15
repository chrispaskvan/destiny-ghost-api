// @ts-check
/**
 * Destiny Error Class
 */
class ResponseError extends Error {
    /**
     * Create a new error from an error response to a Destiny web API request.
     * @param {{ response: { data: *, status: number, statusText: string } }} options
     */
    constructor({ response: { data, status, statusText } }) {
        super();

        this.data = data;
        this.isTransient = status === 408 || status === 429 || status >= 500;
        this.name = 'RequestError';
        this.status = status;
        this.statusText = statusText;
    }
}

export default ResponseError;
