/**
 * Destiny Error Class
 */
class RequestError extends Error {
	/**
	 * Create a new error from an error response to a Destiny web API request.
	 * @param code
	 * @param message
	 * @param status
	 */
	constructor({ response: { data, status, statusText }}) {
		super();

		Object.assign(this, {
			data,
			name: 'RequestError',
			status,
			statusText
		});
	}
}

module.exports = RequestError;
