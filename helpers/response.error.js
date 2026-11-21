// @ts-check
/**
 * The error thrown for a non-ok HTTP response, carrying its status and body.
 */
class ResponseError extends Error {
    /**
     * Create a new error from a non-ok HTTP response.
     * @param {{ response: { data: *, status: number, statusText: string } }} options
     */
    constructor({ response: { data, status, statusText } }) {
        super();

        this.data = data;
        this.isTransient = status === 408 || status === 429 || status >= 500;
        this.name = 'ResponseError';
        this.status = status;
        this.statusText = statusText;
    }
}

export default ResponseError;
