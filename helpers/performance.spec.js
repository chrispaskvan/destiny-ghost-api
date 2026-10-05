import { once } from 'node:events';
import { readFileSync } from 'node:fs';
import { createServer, get } from 'node:http';
import {
    connect,
    createServer as createHttp2Server,
    createSecureServer as createSecureHttp2Server,
} from 'node:http2';
import { getCACertificates, setDefaultCACertificates } from 'node:tls';
import { performance } from 'node:perf_hooks';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import context from './async-context.js';
import log from './log.js';
import performanceHook from './performance.js';

vi.mock('./log.js', () => ({
    default: {
        info: vi.fn(),
    },
}));

/**
 * Both servers wait before sending headers, then finish the body later still,
 * so a request's time to headers and its duration each fall in a known window.
 */
const headersDelay = 50;
const bodyDelay = 100;
const server = createServer((req, res) => {
    setTimeout(() => {
        res.writeHead(200);
        res.write('headers sent');
        setTimeout(
            () => (req.url.startsWith('/reset') ? res.socket.destroy() : res.end()),
            bodyDelay,
        );
    }, headersDelay);
});
const http2Server = createHttp2Server().on('stream', (stream, headers) => {
    stream.on('error', () => undefined);
    setTimeout(() => {
        stream.respond({ ':status': 200 });
        stream.write('headers sent');
        setTimeout(
            () =>
                headers[':path'].startsWith('/reset')
                    ? stream.destroy(new Error('reset'))
                    : stream.end(),
            bodyDelay,
        );
    }, headersDelay);
});
/**
 * fetch speaks HTTP/2 only over TLS, after negotiating it, so this server has
 * a self-signed certificate - for localhost, and trusted only by this spec.
 */
const cert = readFileSync(new URL('../mocks/tls/localhost.cert.pem', import.meta.url), 'utf8');
const secureHttp2Server = createSecureHttp2Server({
    allowHTTP1: true,
    cert,
    key: readFileSync(new URL('../mocks/tls/localhost.key.pem', import.meta.url)),
}).on('request', (_req, res) => {
    setTimeout(() => {
        res.writeHead(200);
        res.write('headers sent');
        setTimeout(() => res.end(), bodyDelay);
    }, headersDelay);
});
const defaultCACertificates = getCACertificates('default');
let port;
let http2Port;
let securePort;

/** @param {string} entry */
const loggedFields = entry =>
    vi.mocked(log.info).mock.calls.find(([fields]) => fields.entry === entry)?.[0];

/**
 * Lower bounds only, with a millisecond of slack for timer and clock rounding,
 * since a loaded event loop can only delay either event. The gap between them
 * separates headers from completion; half the body delay tolerates the
 * headers being handled late.
 */
const expectHeadersThenBody = fields => {
    expect(fields.timeToHeaders).toBeGreaterThanOrEqual(headersDelay - 1);
    expect(fields.duration).toBeGreaterThanOrEqual(headersDelay + bodyDelay - 1);
    expect(fields.duration - fields.timeToHeaders).toBeGreaterThanOrEqual(bodyDelay / 2);
};

describe('performance', () => {
    beforeAll(async () => {
        server.listen(0, '127.0.0.1');
        http2Server.listen(0, '127.0.0.1');
        secureHttp2Server.listen(0, '127.0.0.1');
        await Promise.all([
            once(server, 'listening'),
            once(http2Server, 'listening'),
            once(secureHttp2Server, 'listening'),
        ]);
        ({ port } = server.address());
        ({ port: http2Port } = http2Server.address());
        ({ port: securePort } = secureHttp2Server.address());
        setDefaultCACertificates([...defaultCACertificates, cert]);
    });

    afterAll(() => {
        setDefaultCACertificates(defaultCACertificates);
        server.close();
        http2Server.close();
        secureHttp2Server.close();
    });

    beforeEach(() => performanceHook.enable());

    afterEach(() => performanceHook.disable());

    it('should time fetch to its response headers and body', async () => {
        await (await fetch(`http://127.0.0.1:${port}/fetch?q=1`)).text();

        expectHeadersThenBody(loggedFields(`HTTP Request: GET http://127.0.0.1:${port}/fetch?q=1`));
    });

    /**
     * Over HTTP/2, fetch sends the request on a node:http2 stream, which
     * publishes the http2 channels as well as undici's.
     */
    it('should time fetch over HTTP/2 once, with its time to send', async () => {
        const url = `https://127.0.0.1:${securePort}/fetch-h2`;
        const response = await fetch(url);

        await response.text();
        // The duplicate this guards against completes on the http2 stream's
        // 'close', which follows the end of the body
        await new Promise(resolve => setTimeout(resolve, 50));

        const entries = vi
            .mocked(log.info)
            .mock.calls.filter(([fields]) => fields.entry === `HTTP Request: GET ${url}`);

        expect(entries).toHaveLength(1);
        expectHeadersThenBody(entries[0][0]);
        expect(entries[0][0].timeToSend).toEqual(expect.any(Number));
    });

    it('should still time a node:http2 stream made right after fetch over HTTP/2', async () => {
        const session = connect(`http://127.0.0.1:${http2Port}`);

        await (await fetch(`https://127.0.0.1:${securePort}/before`)).text();
        const stream = session.request({ ':path': '/after' });

        stream.resume();
        await once(stream, 'close');
        session.close();

        expect(loggedFields(`HTTP Request: GET http://127.0.0.1:${http2Port}/after`)).toBeDefined();
    });

    it('should split the time fetch spent waiting to send from the time the server took', async () => {
        await (await fetch(`http://127.0.0.1:${port}/send`)).text();

        const { timeToSend, timeToHeaders } = loggedFields(
            `HTTP Request: GET http://127.0.0.1:${port}/send`,
        );

        expect(timeToSend).toBeGreaterThanOrEqual(0);
        expect(timeToHeaders - timeToSend).toBeGreaterThanOrEqual(headersDelay - 1);
    });

    describe('when called while handling a request', () => {
        const logger = { info: vi.fn() };
        /** @type {import('./async-context.js').Timing[]} */
        let timings;
        /** @param {() => Promise<unknown>} callback */
        const inRequest = callback =>
            context.run(
                // @ts-expect-error - a stand-in for the request's Pino child logger
                new Map([
                    ['logger', logger],
                    ['timings', timings],
                ]),
                callback,
            );

        beforeEach(() => {
            timings = [];
            logger.info.mockClear();
        });

        it("should record each outbound request against the request's timings", async () => {
            await inRequest(async () => {
                await (await fetch(`http://127.0.0.1:${port}/recorded`)).text();
                await new Promise(resolve => {
                    get(`http://127.0.0.1:${port}/recorded`, res =>
                        res.resume().on('close', resolve),
                    );
                });
            });

            expect(timings).toStrictEqual([
                { host: `127.0.0.1:${port}`, duration: expect.any(Number) },
                { host: `127.0.0.1:${port}`, duration: expect.any(Number) },
            ]);
        });

        it('should record a failed request with its error, even an empty one', async () => {
            await inRequest(async () => {
                await fetch(`http://127.0.0.1:${port}/reset/failed`)
                    .then(response => response.text())
                    .catch(() => undefined);
            });

            expect(timings).toEqual([
                {
                    host: `127.0.0.1:${port}`,
                    duration: expect.any(Number),
                    error: expect.any(String),
                },
            ]);
        });

        /**
         * The lookup completes in an async hook's destroy callback, which runs
         * in no request's context; read there, the logger was the root one.
         */
        it("should log a DNS lookup through the request's logger", async () => {
            // A connection of its own, since a pooled one needs no lookup and
            // would leave later tests none to make
            await inRequest(
                () =>
                    new Promise(resolve => {
                        get(`http://localhost:${port}/lookup`, { agent: false }, res =>
                            res.resume().on('close', resolve),
                        );
                    }),
            );

            await vi.waitFor(() => {
                expect(logger.info).toHaveBeenCalledWith(
                    expect.objectContaining({ entry: 'DNS Lookup: localhost' }),
                    'Performance Measurement',
                );
            });
            expect(loggedFields('DNS Lookup: localhost')).toBeUndefined();
        });

        it('should record without logging when each request is not logged', async () => {
            performanceHook.disable();
            performanceHook.enable({ log: false });

            await inRequest(async () => {
                await (await fetch(`http://127.0.0.1:${port}/quiet`)).text();
            });
            await new Promise(resolve => setTimeout(resolve, 10));

            expect(timings).toHaveLength(1);
            expect(logger.info).not.toHaveBeenCalled();
            expect(log.info).not.toHaveBeenCalled();
        });
    });

    it('should time node:http to its response headers and body, and its DNS lookup', async () => {
        await new Promise(resolve => {
            get(`http://localhost:${port}/http?q=1`, res => res.resume().on('end', resolve));
        });

        expectHeadersThenBody(loggedFields(`HTTP Request: GET http://localhost:${port}/http?q=1`));
        await vi.waitFor(() => {
            expect(loggedFields('DNS Lookup: localhost')?.duration).toEqual(expect.any(Number));
        });
    });

    it('should time node:http2 to its response headers and body', async () => {
        const session = connect(`http://127.0.0.1:${http2Port}`);
        const stream = session.request({ ':path': '/http2?q=1' });

        stream.resume();
        await once(stream, 'end');
        await once(stream, 'close');
        session.close();

        expectHeadersThenBody(
            loggedFields(`HTTP Request: GET http://127.0.0.1:${http2Port}/http2?q=1`),
        );
    });

    it('should log the error and duration of a failed request', async () => {
        const unused = createServer().listen(0, '127.0.0.1');

        await once(unused, 'listening');
        const { port: refusedPort } = unused.address();
        await new Promise(resolve => unused.close(resolve));

        await fetch(`http://127.0.0.1:${refusedPort}/fetch`).catch(() => undefined);
        await new Promise(resolve => {
            get(`http://127.0.0.1:${refusedPort}/http`).on('error', resolve);
        });

        for (const url of [
            `http://127.0.0.1:${refusedPort}/fetch`,
            `http://127.0.0.1:${refusedPort}/http`,
        ]) {
            expect(loggedFields(`HTTP Request: GET ${url}`)).toEqual({
                entry: `HTTP Request: GET ${url}`,
                timeToHeaders: undefined,
                duration: expect.any(Number),
                error: expect.stringContaining('ECONNREFUSED'),
            });
        }
    });

    it('should censor credentials in the query string', async () => {
        await (await fetch(`http://127.0.0.1:${port}/redact?token=secret&page=2`)).text();

        expect(
            loggedFields(`HTTP Request: GET http://127.0.0.1:${port}/redact?token=REDACTED&page=2`),
        ).toBeDefined();
        expect(JSON.stringify(vi.mocked(log.info).mock.calls)).not.toContain('secret');
    });

    it('should log a response reset after its headers', async () => {
        await new Promise(resolve => {
            get(`http://127.0.0.1:${port}/reset/http`, res =>
                res
                    .on('error', () => undefined)
                    .on('close', resolve)
                    .resume(),
            );
        });
        await fetch(`http://127.0.0.1:${port}/reset/fetch`)
            .then(response => response.text())
            .catch(() => undefined);
        const session = connect(`http://127.0.0.1:${http2Port}`);
        const stream = session.request({ ':path': '/reset/http2' });

        await new Promise(resolve =>
            stream
                .on('error', () => undefined)
                .on('close', resolve)
                .resume(),
        );
        session.close();

        for (const url of [
            `http://127.0.0.1:${port}/reset/http`,
            `http://127.0.0.1:${port}/reset/fetch`,
            `http://127.0.0.1:${http2Port}/reset/http2`,
        ]) {
            expect(loggedFields(`HTTP Request: GET ${url}`)).toEqual({
                entry: `HTTP Request: GET ${url}`,
                // fetch alone reports when the request was written
                ...(url.endsWith('/fetch') && { timeToSend: expect.any(Number) }),
                timeToHeaders: expect.any(Number),
                duration: expect.any(Number),
                error: expect.any(String),
            });
        }
    });

    it('should leave nothing on the performance timeline', async () => {
        await (await fetch(`http://localhost:${port}/timeline`)).text();

        await vi.waitFor(() => {
            expect(loggedFields('DNS Lookup: localhost')).toBeDefined();
        });
        expect(performance.getEntriesByType('mark')).toHaveLength(0);
        expect(performance.getEntriesByType('measure')).toHaveLength(0);
    });

    it('should stop timing once disabled', async () => {
        performanceHook.disable();

        await (await fetch(`http://localhost:${port}/disabled`)).text();
        await new Promise(resolve => {
            get(`http://localhost:${port}/disabled`, res => res.resume().on('end', resolve));
        });

        expect(log.info).not.toHaveBeenCalled();
    });

    it('should not log a response that completes after being disabled', async () => {
        await new Promise(resolve => {
            get(`http://127.0.0.1:${port}/in-flight`, res => {
                performanceHook.disable();
                res.resume().on('close', resolve);
            });
        });

        expect(
            loggedFields(`HTTP Request: GET http://127.0.0.1:${port}/in-flight`),
        ).toBeUndefined();
    });
});
