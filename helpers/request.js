import ResponseError from './response.error.js';
import log from './log.js';
import { getBackoffDelay, isTransientError } from './retry.js';

/**
 * Parse a Retry-After header value into milliseconds.
 *
 * @param {string} value - Header value (seconds as integer or HTTP date).
 * @returns {number|null} Delay in milliseconds, or null if unparseable.
 */
function parseRetryAfter(value) {
    const seconds = Number(value);

    if (!Number.isNaN(seconds)) return Math.max(0, seconds * 1000);

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
 * @param {object} [retryOptions] - Retry configuration (second argument).
 * @param {number} [retryOptions.maxRetries=3]
 * @param {number} [retryOptions.baseDelay=1000]
 * @param {number} [retryOptions.maxDelay=15000]
 * @returns {Promise<{ data: *, headers: object }>}
 */
async function request({ url, method, headers = {}, data: body, ...rest } = {}, { maxRetries = 3, baseDelay = 1000, maxDelay = 15000 } = {}) {
    const retries = Number.isFinite(maxRetries)
        ? Math.max(0, Math.trunc(maxRetries))
        : 0;
    const init = { method, headers: { ...headers }, ...rest };

    if (body !== undefined) {
        init.body = typeof body === 'string' ? body : JSON.stringify(body);

        if (typeof body !== 'string' && !('Content-Type' in init.headers)) {
            init.headers['Content-Type'] = 'application/json';
        }
    }

    for (let attempt = 0; attempt <= retries; attempt++) {
        let response;

        try {
            response = await fetch(url, init);
        } catch (networkErr) {
            if (attempt < retries && isTransientError(networkErr)) {
                const delay = getBackoffDelay(attempt, baseDelay, maxDelay);

                log.warn({ attempt: attempt + 1, delay, err: networkErr, url }, 'Retrying HTTP request after network error');

                await new Promise(resolve => setTimeout(resolve, delay));
                continue;
            }

            throw networkErr;
        }

        const contentType = response.headers.get('content-type') ?? '';
        const rawText = await response.text();
        let data;

        if (contentType.includes('application/json')) {
            if (response.ok) {
                data = JSON.parse(rawText);
            } else {
                try {
                    data = JSON.parse(rawText);
                } catch {
                    data = rawText;
                }
            }
        } else {
            data = rawText;
        }

        if (!response.ok) {
            const responseError = new ResponseError({
                response: {
                    data,
                    status: response.status,
                    statusText: response.statusText,
                },
            });

            if (responseError.isTransient && attempt < retries) {
                const retryAfterHeader = response.headers.get('retry-after');
                const parsed = retryAfterHeader != null
                    ? parseRetryAfter(retryAfterHeader)
                    : null;
                const delay = parsed != null
                    ? parsed
                    : getBackoffDelay(attempt, baseDelay, maxDelay);

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

async function get(options, includeHeaders = false, retryOptions) {
    const result = await request({ method: 'get', ...options }, retryOptions);

    return includeHeaders ? result : result.data;
}

async function post(options, retryOptions) {
    const { data } = await request({ method: 'post', ...options }, { maxRetries: 0, ...retryOptions });

    return data;
}

export { get, post };
