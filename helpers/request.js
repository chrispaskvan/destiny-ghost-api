import ResponseError from './response.error.js';
import log from './log.js';
import { getBackoffDelay } from './retry.js';

/**
 * Parse a Retry-After header value into milliseconds.
 *
 * @param {string} value - Header value (seconds as integer or HTTP date).
 * @returns {number|null} Delay in milliseconds, or null if unparseable.
 */
function parseRetryAfter(value) {
    const seconds = Number(value);

    if (!Number.isNaN(seconds)) return seconds * 1000;

    const ms = new Date(value) - Date.now();

    return Number.isNaN(ms) ? null : Math.max(0, ms);
}

/**
 * HTTP Request Client
 *
 * @param {object} options
 * @param {string} options.url - The request URL.
 * @param {string} options.method - The HTTP method.
 * @param {object} [options.headers] - Request headers.
 * @param {*} [options.data] - Request body.
 * @param {object} [retryOptions]
 * @param {number} [retryOptions.maxRetries=3]
 * @param {number} [retryOptions.baseDelay=1000]
 * @param {number} [retryOptions.maxDelay=15000]
 * @returns {Promise<{ data: *, headers: object }>}
 */
async function request({ url, method, headers = {}, data: body, ...rest } = {}, { maxRetries = 3, baseDelay = 1000, maxDelay = 15000 } = {}) {
    const init = { method, headers: { ...headers }, ...rest };

    if (body !== undefined) {
        init.body = typeof body === 'string' ? body : JSON.stringify(body);

        if (typeof body !== 'string' && !('Content-Type' in init.headers)) {
            init.headers['Content-Type'] = 'application/json';
        }
    }

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
        let response;

        try {
            response = await fetch(url, init);
        } catch (networkErr) {
            if (attempt < maxRetries) {
                const delay = getBackoffDelay(attempt, baseDelay, maxDelay);

                log.warn({ attempt: attempt + 1, delay, err: networkErr, url }, 'Retrying HTTP request after network error');

                await new Promise(resolve => setTimeout(resolve, delay));
                continue;
            }

            throw networkErr;
        }

        const contentType = response.headers.get('content-type') ?? '';
        const data = contentType.includes('application/json')
            ? await response.json()
            : await response.text();

        if (!response.ok) {
            const responseError = new ResponseError({
                response: {
                    data,
                    status: response.status,
                    statusText: response.statusText,
                },
            });

            if (responseError.isTransient && attempt < maxRetries) {
                const retryAfterHeader = response.headers.get('retry-after');
                const delay = (retryAfterHeader && parseRetryAfter(retryAfterHeader))
                    ?? getBackoffDelay(attempt, baseDelay, maxDelay);

                log.warn({ attempt: attempt + 1, delay, status: response.status, url }, 'Retrying HTTP request');

                await new Promise(resolve => setTimeout(resolve, delay));
                continue;
            }

            log.error({ err: responseError }, 'HTTP request failed!');

            throw responseError;
        }

        return { data, headers: Object.fromEntries(response.headers) };
    }
}

async function get(options, includeHeaders = false) {
    const result = await request({ method: 'get', ...options });

    return includeHeaders ? result : result.data;
}

async function post(options) {
    const { data } = await request({ method: 'post', ...options });

    return data;
}

export { get, post };
