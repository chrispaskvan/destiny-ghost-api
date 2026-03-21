import {
    afterEach, beforeEach, describe, expect, it, vi,
} from 'vitest';
import ResponseError from './response.error.js';

vi.mock('./log.js', () => ({
    default: {
        error: vi.fn(),
        warn: vi.fn(),
    },
}));

describe('request', () => {
    let get;
    let post;

    beforeEach(async () => {
        vi.clearAllMocks();
        vi.stubGlobal('fetch', vi.fn());

        const mod = await import('./request.js');

        get = mod.get;
        post = mod.post;
    });

    afterEach(() => {
        vi.unstubAllGlobals();
    });

    function mockResponse({ status = 200, body, contentType, headers = {} } = {}) {
        const headerEntries = { ...headers };

        if (contentType !== undefined) {
            headerEntries['content-type'] = contentType;
        }

        const responseHeaders = new Headers(headerEntries);

        return {
            ok: status >= 200 && status < 300,
            status,
            statusText: status === 200 ? 'OK' : 'Bad Request',
            headers: responseHeaders,
            json: vi.fn().mockResolvedValue(body),
            text: vi.fn().mockResolvedValue(typeof body === 'string' ? body : JSON.stringify(body)),
        };
    }

    describe('get', () => {
        it('should return data for a JSON response', async () => {
            const body = { name: 'test' };

            global.fetch.mockResolvedValue(mockResponse({ body, contentType: 'application/json' }));

            const result = await get({ url: 'https://example.com/api' });

            expect(result).toEqual(body);
            expect(global.fetch).toHaveBeenCalledWith('https://example.com/api', expect.objectContaining({
                method: 'get',
            }));
        });

        it('should return data and headers when includeHeaders is true', async () => {
            const body = { name: 'test' };

            global.fetch.mockResolvedValue(mockResponse({ body, contentType: 'application/json', headers: { 'x-custom': 'value' } }));

            const result = await get({ url: 'https://example.com/api' }, true);

            expect(result.data).toEqual(body);
            expect(result.headers).toHaveProperty('x-custom', 'value');
        });

        it('should return text for a non-JSON response', async () => {
            const body = 'plain text';

            global.fetch.mockResolvedValue(mockResponse({ body, contentType: 'text/plain' }));

            const result = await get({ url: 'https://example.com/api' });

            expect(result).toBe('plain text');
        });

        it('should throw ResponseError on non-ok response', async () => {
            global.fetch.mockResolvedValue(mockResponse({ status: 404, contentType: 'application/json', body: { error: 'not found' } }));

            await expect(get({ url: 'https://example.com/api' })).rejects.toThrow(ResponseError);
        });
    });

    describe('post', () => {
        it('should send JSON body and return data', async () => {
            const requestBody = { key: 'value' };
            const responseBody = { id: 1 };

            global.fetch.mockResolvedValue(mockResponse({ body: responseBody, contentType: 'application/json' }));

            const result = await post({ url: 'https://example.com/api', data: requestBody });

            expect(result).toEqual(responseBody);
            expect(global.fetch).toHaveBeenCalledWith('https://example.com/api', expect.objectContaining({
                method: 'post',
                body: JSON.stringify(requestBody),
                headers: expect.objectContaining({ 'Content-Type': 'application/json' }),
            }));
        });

        it('should send string body without adding Content-Type', async () => {
            const responseBody = { ok: true };

            global.fetch.mockResolvedValue(mockResponse({ body: responseBody, contentType: 'application/json' }));

            await post({ url: 'https://example.com/api', data: 'raw-body' });

            expect(global.fetch).toHaveBeenCalledWith('https://example.com/api', expect.objectContaining({
                body: 'raw-body',
            }));

            const callHeaders = global.fetch.mock.calls[0][1].headers;

            expect(callHeaders).not.toHaveProperty('Content-Type');
        });

        it('should not set body when data is undefined', async () => {
            global.fetch.mockResolvedValue(mockResponse({ body: {}, contentType: 'application/json' }));

            await post({ url: 'https://example.com/api' });

            const callInit = global.fetch.mock.calls[0][1];

            expect(callInit.body).toBeUndefined();
        });

        it('should not override Content-Type when already provided', async () => {
            const responseBody = { ok: true };

            global.fetch.mockResolvedValue(mockResponse({ body: responseBody, contentType: 'application/json' }));

            await post({
                url: 'https://example.com/api',
                data: { key: 'value' },
                headers: { 'Content-Type': 'application/xml' },
            });

            const callHeaders = global.fetch.mock.calls[0][1].headers;

            expect(callHeaders['Content-Type']).toBe('application/xml');
        });

        it('should handle response with no content-type header', async () => {
            global.fetch.mockResolvedValue(mockResponse({ body: '' }));

            const result = await post({ url: 'https://example.com/api' });

            expect(result).toBe('');
        });
    });
});

/**
 * Retry-focused tests use real Response objects and fake timers.
 */
import { get } from './request.js';

function makeResponse(status, body = '', { contentType = 'application/json', headers = {} } = {}) {
    return new Response(typeof body === 'string' ? body : JSON.stringify(body), {
        status,
        headers: { 'content-type': contentType, ...headers },
    });
}

describe('request retry logic', () => {
    beforeEach(() => {
        vi.useFakeTimers();
    });

    afterEach(() => {
        vi.useRealTimers();
        vi.unstubAllGlobals();
    });

    it('succeeds on the first attempt without retrying', async () => {
        const fetchMock = vi.fn().mockResolvedValue(makeResponse(200, { ok: true }));

        vi.stubGlobal('fetch', fetchMock);

        const result = await get({ url: 'https://example.com/api' });

        expect(fetchMock).toHaveBeenCalledTimes(1);
        expect(result).toEqual({ ok: true });
    });

    it('retries on 503 and succeeds on the second attempt', async () => {
        const fetchMock = vi.fn()
            .mockResolvedValueOnce(makeResponse(503, 'error', { contentType: 'text/plain' }))
            .mockResolvedValueOnce(makeResponse(200, { ok: true }));

        vi.stubGlobal('fetch', fetchMock);

        const promise = get({ url: 'https://example.com/api' });

        await vi.runAllTimersAsync();

        const result = await promise;

        expect(fetchMock).toHaveBeenCalledTimes(2);
        expect(result).toEqual({ ok: true });
    });

    it('retries on 500, 502, 504 (all transient codes)', async () => {
        for (const status of [500, 502, 504]) {
            const fetchMock = vi.fn()
                .mockResolvedValueOnce(makeResponse(status, 'error', { contentType: 'text/plain' }))
                .mockResolvedValueOnce(makeResponse(200, { data: status }));

            vi.stubGlobal('fetch', fetchMock);

            const promise = get({ url: 'https://example.com/api' });

            await vi.runAllTimersAsync();

            const result = await promise;

            expect(fetchMock).toHaveBeenCalledTimes(2);
            expect(result).toEqual({ data: status });
        }
    });

    it('retries on 429 and respects Retry-After header', async () => {
        const fetchMock = vi.fn()
            .mockResolvedValueOnce(makeResponse(429, 'rate limited', {
                contentType: 'text/plain',
                headers: { 'retry-after': '2' },
            }))
            .mockResolvedValueOnce(makeResponse(200, { ok: true }));

        vi.stubGlobal('fetch', fetchMock);

        const promise = get({ url: 'https://example.com/api' });

        await vi.runAllTimersAsync();

        const result = await promise;

        expect(fetchMock).toHaveBeenCalledTimes(2);
        expect(result).toEqual({ ok: true });
    });

    it('falls back to backoff delay when Retry-After header is unparseable', async () => {
        const fetchMock = vi.fn()
            .mockResolvedValueOnce(makeResponse(429, 'rate limited', {
                contentType: 'text/plain',
                headers: { 'retry-after': 'garbage' },
            }))
            .mockResolvedValueOnce(makeResponse(200, { ok: true }));

        vi.stubGlobal('fetch', fetchMock);

        const promise = get({ url: 'https://example.com/api' });

        await vi.runAllTimersAsync();

        const result = await promise;

        expect(fetchMock).toHaveBeenCalledTimes(2);
        expect(result).toEqual({ ok: true });
    });

    it('clamps negative Retry-After to zero delay', async () => {
        const fetchMock = vi.fn()
            .mockResolvedValueOnce(makeResponse(429, 'rate limited', {
                contentType: 'text/plain',
                headers: { 'retry-after': '-5' },
            }))
            .mockResolvedValueOnce(makeResponse(200, { ok: true }));

        vi.stubGlobal('fetch', fetchMock);

        const promise = get({ url: 'https://example.com/api' });

        await vi.runAllTimersAsync();

        const result = await promise;

        expect(fetchMock).toHaveBeenCalledTimes(2);
        expect(result).toEqual({ ok: true });
    });

    it('exhausts retries and throws on persistent transient errors', async () => {
        const fetchMock = vi.fn()
            .mockImplementation(() => Promise.resolve(makeResponse(503, 'error', { contentType: 'text/plain' })));

        vi.stubGlobal('fetch', fetchMock);

        const promise = get({ url: 'https://example.com/api' });
        const assertion = expect(promise).rejects.toMatchObject({ status: 503 });

        await vi.runAllTimersAsync();
        await assertion;

        expect(fetchMock).toHaveBeenCalledTimes(4); // 1 initial + 3 retries
    });

    it('does not retry on 400 Bad Request', async () => {
        const fetchMock = vi.fn()
            .mockImplementation(() => Promise.resolve(makeResponse(400, 'bad request', { contentType: 'text/plain' })));

        vi.stubGlobal('fetch', fetchMock);

        await expect(get({ url: 'https://example.com/api' })).rejects.toMatchObject({ status: 400 });
        expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it('does not retry on 401 Unauthorized', async () => {
        const fetchMock = vi.fn()
            .mockImplementation(() => Promise.resolve(makeResponse(401, 'unauthorized', { contentType: 'text/plain' })));

        vi.stubGlobal('fetch', fetchMock);

        await expect(get({ url: 'https://example.com/api' })).rejects.toMatchObject({ status: 401 });
        expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it('does not retry on 403 Forbidden', async () => {
        const fetchMock = vi.fn()
            .mockImplementation(() => Promise.resolve(makeResponse(403, 'forbidden', { contentType: 'text/plain' })));

        vi.stubGlobal('fetch', fetchMock);

        await expect(get({ url: 'https://example.com/api' })).rejects.toMatchObject({ status: 403 });
        expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it('does not retry on 404 Not Found', async () => {
        const fetchMock = vi.fn()
            .mockImplementation(() => Promise.resolve(makeResponse(404, 'not found', { contentType: 'text/plain' })));

        vi.stubGlobal('fetch', fetchMock);

        await expect(get({ url: 'https://example.com/api' })).rejects.toMatchObject({ status: 404 });
        expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it('retries on transient network error (fetch throws TypeError) and succeeds', async () => {
        const fetchMock = vi.fn()
            .mockRejectedValueOnce(new TypeError('fetch failed'))
            .mockResolvedValueOnce(makeResponse(200, { ok: true }));

        vi.stubGlobal('fetch', fetchMock);

        const promise = get({ url: 'https://example.com/api' });

        await vi.runAllTimersAsync();

        const result = await promise;

        expect(fetchMock).toHaveBeenCalledTimes(2);
        expect(result).toEqual({ ok: true });
    });

    it('does not retry on non-transient fetch error', async () => {
        const fetchMock = vi.fn().mockRejectedValue(new Error('invalid URL'));

        vi.stubGlobal('fetch', fetchMock);

        await expect(get({ url: 'https://example.com/api' })).rejects.toThrow('invalid URL');
        expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it('throws after exhausting retries on persistent network errors', async () => {
        const fetchMock = vi.fn().mockRejectedValue(new TypeError('fetch failed'));

        vi.stubGlobal('fetch', fetchMock);

        const promise = get({ url: 'https://example.com/api' });
        const assertion = expect(promise).rejects.toThrow('fetch failed');

        await vi.runAllTimersAsync();
        await assertion;

        expect(fetchMock).toHaveBeenCalledTimes(4); // 1 initial + 3 retries
    });
});

describe('ResponseError.isTransient', () => {
    beforeEach(() => {
        vi.useFakeTimers();
    });

    afterEach(() => {
        vi.useRealTimers();
        vi.unstubAllGlobals();
    });

    it.each([408, 429, 500, 502, 503, 504])('status %i is transient', async status => {
        const fetchMock = vi.fn()
            .mockImplementation(() => Promise.resolve(makeResponse(status, 'error', { contentType: 'text/plain' })));

        vi.stubGlobal('fetch', fetchMock);

        const promise = get({ url: 'https://example.com/api' });
        const errPromise = promise.catch(e => e); // attach before timers fire

        await vi.runAllTimersAsync();

        const err = await errPromise;

        expect(err.isTransient).toBe(true);
    });

    it.each([400, 401, 403, 404, 422])('status %i is not transient', async status => {
        const fetchMock = vi.fn()
            .mockImplementation(() => Promise.resolve(makeResponse(status, 'error', { contentType: 'text/plain' })));

        vi.stubGlobal('fetch', fetchMock);

        const err = await get({ url: 'https://example.com/api' }).catch(e => e);

        expect(err.isTransient).toBe(false);
    });
});
