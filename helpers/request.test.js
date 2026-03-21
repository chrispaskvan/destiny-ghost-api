import {
    afterEach, beforeEach, describe, expect, test, vi,
} from 'vitest';
import { get, post } from './request.js';

vi.mock('./log.js', () => ({
    default: {
        error: vi.fn(),
        warn: vi.fn(),
    },
}));

function makeResponse(status, body = '', { contentType = 'application/json', headers = {} } = {}) {
    return new Response(typeof body === 'string' ? body : JSON.stringify(body), {
        status,
        headers: { 'content-type': contentType, ...headers },
    });
}

beforeEach(() => {
    vi.useFakeTimers();
});

afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
});

describe('request retry logic', () => {
    test('succeeds on the first attempt without retrying', async () => {
        const fetchMock = vi.fn().mockResolvedValue(makeResponse(200, { ok: true }));

        vi.stubGlobal('fetch', fetchMock);

        const result = await get({ url: 'https://example.com/api' });

        expect(fetchMock).toHaveBeenCalledTimes(1);
        expect(result).toEqual({ ok: true });
    });

    test('retries on 503 and succeeds on the second attempt', async () => {
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

    test('retries on 500, 502, 504 (all transient codes)', async () => {
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

    test('retries on 429 and respects Retry-After header', async () => {
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

    test('falls back to backoff delay when Retry-After header is unparseable', async () => {
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

    test('clamps negative Retry-After to zero delay', async () => {
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

    test('exhausts retries and throws on persistent transient errors', async () => {
        const fetchMock = vi.fn()
            .mockImplementation(() => Promise.resolve(makeResponse(503, 'error', { contentType: 'text/plain' })));

        vi.stubGlobal('fetch', fetchMock);

        const promise = get({ url: 'https://example.com/api' });
        const assertion = expect(promise).rejects.toMatchObject({ status: 503 });

        await vi.runAllTimersAsync();
        await assertion;

        expect(fetchMock).toHaveBeenCalledTimes(4); // 1 initial + 3 retries
    });

    test('does not retry on 400 Bad Request', async () => {
        const fetchMock = vi.fn()
            .mockImplementation(() => Promise.resolve(makeResponse(400, 'bad request', { contentType: 'text/plain' })));

        vi.stubGlobal('fetch', fetchMock);

        await expect(get({ url: 'https://example.com/api' })).rejects.toMatchObject({ status: 400 });
        expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    test('does not retry on 401 Unauthorized', async () => {
        const fetchMock = vi.fn()
            .mockImplementation(() => Promise.resolve(makeResponse(401, 'unauthorized', { contentType: 'text/plain' })));

        vi.stubGlobal('fetch', fetchMock);

        await expect(get({ url: 'https://example.com/api' })).rejects.toMatchObject({ status: 401 });
        expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    test('does not retry on 403 Forbidden', async () => {
        const fetchMock = vi.fn()
            .mockImplementation(() => Promise.resolve(makeResponse(403, 'forbidden', { contentType: 'text/plain' })));

        vi.stubGlobal('fetch', fetchMock);

        await expect(get({ url: 'https://example.com/api' })).rejects.toMatchObject({ status: 403 });
        expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    test('does not retry on 404 Not Found', async () => {
        const fetchMock = vi.fn()
            .mockImplementation(() => Promise.resolve(makeResponse(404, 'not found', { contentType: 'text/plain' })));

        vi.stubGlobal('fetch', fetchMock);

        await expect(get({ url: 'https://example.com/api' })).rejects.toMatchObject({ status: 404 });
        expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    test('retries on network error (fetch throws) and succeeds', async () => {
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

    test('throws after exhausting retries on persistent network errors', async () => {
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
    test.each([408, 429, 500, 502, 503, 504])('status %i is transient', async status => {
        const fetchMock = vi.fn()
            .mockImplementation(() => Promise.resolve(makeResponse(status, 'error', { contentType: 'text/plain' })));

        vi.stubGlobal('fetch', fetchMock);

        const promise = get({ url: 'https://example.com/api' });
        const errPromise = promise.catch(e => e); // attach before timers fire

        await vi.runAllTimersAsync();

        const err = await errPromise;

        expect(err.isTransient).toBe(true);
    });

    test.each([400, 401, 403, 404, 422])('status %i is not transient', async status => {
        const fetchMock = vi.fn()
            .mockImplementation(() => Promise.resolve(makeResponse(status, 'error', { contentType: 'text/plain' })));

        vi.stubGlobal('fetch', fetchMock);

        const err = await get({ url: 'https://example.com/api' }).catch(e => e);

        expect(err.isTransient).toBe(false);
    });
});

describe('post', () => {
    test('sends JSON body and returns response data', async () => {
        const fetchMock = vi.fn().mockResolvedValue(makeResponse(200, { created: true }));

        vi.stubGlobal('fetch', fetchMock);

        const result = await post({ url: 'https://example.com/api', data: { name: 'test' } });

        expect(result).toEqual({ created: true });
        expect(fetchMock).toHaveBeenCalledWith(
            'https://example.com/api',
            expect.objectContaining({
                method: 'post',
                body: JSON.stringify({ name: 'test' }),
                headers: expect.objectContaining({ 'Content-Type': 'application/json' }),
            }),
        );
    });
});
