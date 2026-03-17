import {
    afterEach, beforeEach, describe, expect, it, vi,
} from 'vitest';
import ResponseError from './response.error.js';

vi.mock('./log.js', () => ({
    default: {
        error: vi.fn(),
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
