import { StatusCodes } from 'http-status-codes';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('./request.js', () => ({
    get: vi.fn(),
    post: vi.fn(),
}));

vi.mock('./config.js', () => ({
    default: {},
}));

vi.mock('./log.js', () => ({
    default: {
        error: vi.fn(),
        info: vi.fn(),
        warn: vi.fn(),
    },
}));

describe('bungie.request', () => {
    let breaker;
    let bungie;
    let httpGet;
    let httpPost;
    let log;
    let ResponseError;

    const transientError = () =>
        new ResponseError({
            response: {
                data: {},
                status: StatusCodes.SERVICE_UNAVAILABLE,
                statusText: 'Service Unavailable',
            },
        });
    const nonTransientError = () =>
        new ResponseError({
            response: {
                data: {},
                status: StatusCodes.NOT_FOUND,
                statusText: 'Not Found',
            },
        });

    /**
     * Defaults from bungie.request.js: volumeThreshold 5, timeout 8000,
     * resetTimeout 30000. Five consecutive transient failures open the circuit.
     */
    async function openBreaker() {
        httpGet.mockRejectedValue(transientError());

        for (let i = 0; i < 5; i++) {
            await expect(bungie.get({ url: 'https://example.com/api' })).rejects.toMatchObject({
                name: 'RequestError',
            });
        }
    }

    beforeEach(async () => {
        vi.useFakeTimers();
        vi.resetModules();

        bungie = await import('./bungie.request.js');
        breaker = bungie.breaker;
        ({ get: httpGet, post: httpPost } = await import('./request.js'));
        ({ default: log } = await import('./log.js'));
        ({ default: ResponseError } = await import('./response.error.js'));
    });

    afterEach(() => {
        breaker.shutdown();
        vi.useRealTimers();
        vi.clearAllMocks();
    });

    describe('pass-through', () => {
        it('should delegate get and return its data', async () => {
            const body = { name: 'test' };

            httpGet.mockResolvedValue(body);

            const result = await bungie.get({ url: 'https://example.com/api' });

            expect(result).toEqual(body);
            expect(httpGet).toHaveBeenCalledWith(
                expect.objectContaining({
                    signal: expect.any(AbortSignal),
                    url: 'https://example.com/api',
                }),
                false,
                expect.objectContaining({ baseDelay: 500, maxDelay: 1000, maxRetries: 1 }),
            );
        });

        it('should combine a caller-provided signal with the timeout signal', async () => {
            const controller = new AbortController();

            httpGet.mockResolvedValue({});

            await bungie.get({ signal: controller.signal, url: 'https://example.com/api' });

            const [{ signal }] = httpGet.mock.calls[0];

            expect(signal).not.toBe(controller.signal);
            expect(signal.aborted).toBe(false);

            controller.abort();

            expect(signal.aborted).toBe(true);
        });

        it('should forward includeHeaders and caller retry overrides', async () => {
            const body = { data: { name: 'test' }, headers: {} };

            httpGet.mockResolvedValue(body);

            const result = await bungie.get({ url: 'https://example.com/api' }, true, {
                maxRetries: 3,
            });

            expect(result).toEqual(body);
            expect(httpGet).toHaveBeenCalledWith(
                expect.any(Object),
                true,
                expect.objectContaining({ baseDelay: 500, maxRetries: 3 }),
            );
        });

        it('should delegate post and return its data', async () => {
            const body = { id: 1 };

            httpPost.mockResolvedValue(body);

            const result = await bungie.post({ url: 'https://example.com/api', data: {} });

            expect(result).toEqual(body);
            expect(httpPost).toHaveBeenCalledWith(
                expect.objectContaining({
                    signal: expect.any(AbortSignal),
                    url: 'https://example.com/api',
                }),
                expect.objectContaining({ baseDelay: 500, maxDelay: 1000, maxRetries: 1 }),
            );
        });
    });

    describe('open circuit', () => {
        it('should open after the volume threshold of transient failures', async () => {
            await openBreaker();

            expect(log.warn).toHaveBeenCalledWith('Bungie circuit breaker opened');
            expect(breaker.opened).toBe(true);
        });

        it('should fail fast with a 503 without calling the underlying helper', async () => {
            await openBreaker();

            expect(httpGet).toHaveBeenCalledTimes(5);

            await expect(bungie.get({ url: 'https://example.com/api' })).rejects.toMatchObject({
                code: 'EOPENBREAKER',
                message: 'Bungie API circuit breaker is open.',
                statusCode: StatusCodes.SERVICE_UNAVAILABLE,
            });
            expect(httpGet).toHaveBeenCalledTimes(5);
        });
    });

    describe('errorFilter', () => {
        it('should not open the circuit on non-transient errors', async () => {
            httpGet.mockRejectedValue(nonTransientError());

            for (let i = 0; i < 10; i++) {
                await expect(bungie.get({ url: 'https://example.com/api' })).rejects.toMatchObject({
                    status: StatusCodes.NOT_FOUND,
                });
            }

            expect(breaker.opened).toBe(false);

            httpGet.mockResolvedValue({ ok: true });

            await expect(bungie.get({ url: 'https://example.com/api' })).resolves.toEqual({
                ok: true,
            });
            expect(httpGet).toHaveBeenCalledTimes(11);
        });
    });

    describe('recovery', () => {
        it('should close again after a successful half-open probe', async () => {
            await openBreaker();

            await vi.advanceTimersByTimeAsync(30000);

            expect(log.info).toHaveBeenCalledWith('Bungie circuit breaker half-open; probing');

            httpGet.mockResolvedValue({ ok: true });

            await expect(bungie.get({ url: 'https://example.com/api' })).resolves.toEqual({
                ok: true,
            });
            expect(log.info).toHaveBeenCalledWith('Bungie circuit breaker closed');
            expect(breaker.closed).toBe(true);
        });

        it('should reopen when the half-open probe fails', async () => {
            await openBreaker();

            await vi.advanceTimersByTimeAsync(30000);

            await expect(bungie.get({ url: 'https://example.com/api' })).rejects.toMatchObject({
                name: 'RequestError',
            });
            expect(breaker.opened).toBe(true);

            const calls = httpGet.mock.calls.length;

            await expect(bungie.get({ url: 'https://example.com/api' })).rejects.toMatchObject({
                code: 'EOPENBREAKER',
            });
            expect(httpGet).toHaveBeenCalledTimes(calls);
        });
    });

    describe('timeout', () => {
        it('should count a hung request as a timeout failure', async () => {
            httpGet.mockImplementation(() => new Promise(() => {}));

            const promise = bungie.get({ url: 'https://example.com/api' });
            const assertion = expect(promise).rejects.toMatchObject({ code: 'ETIMEDOUT' });

            await vi.advanceTimersByTimeAsync(8000);
            await assertion;

            expect(bungie.getCircuitBreakerStatus().stats.timeouts).toBe(1);
        });
    });

    describe('getCircuitBreakerStatus', () => {
        it('should report a closed breaker with rolling statistics', async () => {
            httpGet.mockResolvedValue({ ok: true });

            await bungie.get({ url: 'https://example.com/api' });

            const status = bungie.getCircuitBreakerStatus();

            expect(status.state).toBe('closed');
            expect(status.stats).toMatchObject({ failures: 0, successes: 1 });
        });

        it('should report an open breaker', async () => {
            await openBreaker();

            expect(bungie.getCircuitBreakerStatus().state).toBe('open');
        });
    });
});
