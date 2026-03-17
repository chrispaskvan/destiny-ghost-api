import ResponseError from './response.error.js';
import log from './log.js';

/**
 * HTTP Request Client
 *
 * @param {object} options
 * @param {string} options.url - The request URL.
 * @param {string} options.method - The HTTP method.
 * @param {object} [options.headers] - Request headers.
 * @param {*} [options.data] - Request body.
 * @returns {Promise<{ data: *, headers: object }>}
 */
async function request({ url, method, headers = {}, data: body, ...rest } = {}) {
    const init = { method, headers: { ...headers }, ...rest };

    if (body !== undefined) {
        init.body = typeof body === 'string' ? body : JSON.stringify(body);

        if (typeof body !== 'string' && !('Content-Type' in init.headers)) {
            init.headers['Content-Type'] = 'application/json';
        }
    }

    const response = await fetch(url, init);
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

        log.error({ err: responseError }, 'HTTP request failed!');

        throw responseError;
    }

    return { data, headers: Object.fromEntries(response.headers) };
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
