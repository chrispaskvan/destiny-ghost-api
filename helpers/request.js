// @ts-check
import ResponseError from './response.error.js';
import log from './log.js';
import { getBackoffDelay, isTransientError } from './retry.js';

/**
 * `url`/`data` plus anything from `RequestInit` (e.g. `redirect`) other than
 * `method`/`headers`/`body`, which this module manages itself.
 * @typedef {{
 *   url: string,
 *   method: string,
 *   headers?: Record<string, string>,
 *   data?: *,
 * } & Omit<RequestInit, 'method' | 'headers' | 'body'>} RequestOptions
 */

/**
 * @typedef {Object} RetryOptions
 * @property {number} [maxRetries=3]
 * @property {number} [baseDelay=1000]
 * @property {number} [maxDelay=15000]
 */

/**
 * Parse a Retry-After header value into milliseconds.
 *
 * @param {string} value - Header value (seconds as integer or HTTP date).
 * @returns {number|null} Delay in milliseconds, or null if unparseable.
 */
function parseRetryAfter(value) {
    const seconds = Number(value);

    if (!Number.isNaN(seconds)) return Math.max(0, seconds * 1000);

    const ms = new Date(value).getTime() - Date.now();

    return Number.isNaN(ms) ? null : Math.max(0, ms);
}

/**
 * HTTP Request Client
 *
 * @param {RequestOptions} options
 * @param {RetryOptions} [retryOptions] - Retry configuration (second argument).
 * @returns {Promise<{ data: *, headers: Record<string, string> }>}
 */
async function request(
    { url, method, headers = {}, data: body, ...rest },
    { maxRetries = 3, baseDelay = 1000, maxDelay = 15000 } = {},
) {
    const retries = Number.isFinite(maxRetries) ? Math.max(0, Math.trunc(maxRetries)) : 0;
    /** @type {RequestInit & { headers: Record<string, string> }} */
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
            if (attempt < retries && networkErr instanceof Error && isTransientError(networkErr)) {
                const delay = getBackoffDelay(attempt, baseDelay, maxDelay);

                log.warn(
                    { attempt: attempt + 1, delay, err: networkErr, url },
                    'Retrying HTTP request after network error',
                );

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
                const parsed = retryAfterHeader != null ? parseRetryAfter(retryAfterHeader) : null;
                const delay =
                    parsed != null ? parsed : getBackoffDelay(attempt, baseDelay, maxDelay);

                log.warn(
                    { attempt: attempt + 1, delay, status: response.status, url },
                    'Retrying HTTP request',
                );

                await new Promise(resolve => setTimeout(resolve, delay));
                continue;
            }

            /**
             * A non-transient 4xx is the caller's problem, not an outage - an
             * expired Bungie token probed on purpose lands here - so it is a
             * warning. The url and status ride along either way, since the
             * error alone names no upstream.
             */
            log[responseError.isTransient ? 'error' : 'warn'](
                { err: responseError, status: response.status, url },
                'HTTP request failed!',
            );

            throw responseError;
        }

        return { data, headers: Object.fromEntries(response.headers) };
    }

    // Unreachable: every loop iteration above continues, throws, or returns.
    throw new Error('Exhausted retries without a response or error');
}

/**
 * @param {Omit<RequestOptions, 'method'>} options
 * @param {boolean} [includeHeaders]
 * @param {RetryOptions} [retryOptions]
 */
async function get(options, includeHeaders = false, retryOptions) {
    const result = await request({ method: 'get', ...options }, retryOptions);

    return includeHeaders ? result : result.data;
}

/**
 * @param {Omit<RequestOptions, 'method'>} options
 * @param {RetryOptions} [retryOptions]
 */
async function post(options, retryOptions) {
    const { data } = await request(
        { method: 'post', ...options },
        { maxRetries: 0, ...retryOptions },
    );

    return data;
}

export { get, post };
