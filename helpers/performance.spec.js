import { lookup as dnsLookup } from 'node:dns';
import { once } from 'node:events';
import { readFileSync } from 'node:fs';
import { createServer, get } from 'node:http';
import { get as getSecure } from 'node:https';
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
import performanceHook, { logsEach } from './performance.js';

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
        // fetch pools its connections, and a pooled one makes no lookup
        if (req.url.startsWith('/lookup')) {
            res.setHeader('connection', 'close');
        }
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

/**
 * A `lookup` option that fails the way getaddrinfo does for an unknown host,
 * without asking a resolver. Used on localhost, since the spec's connection
 * guard counts a dial to any other host, resolved or not.
 * @param {string} hostname
 * @param {object} _options
 * @param {(error: Error) => void} callback
 */
const failingLookup = (hostname, _options, callback) =>
    process.nextTick(() =>
        callback(
            Object.assign(new Error(`getaddrinfo ENOTFOUND ${hostname}`), { code: 'ENOTFOUND' }),
        ),
    );

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
        /** @type {import('./async-context.js').Timing[]} */
        let lookups;
        /** @param {() => Promise<unknown>} callback */
        const inRequest = callback =>
            context.run(
                // @ts-expect-error - a stand-in for the request's Pino child logger
                new Map([
                    ['logger', logger],
                    ['timings', timings],
                    ['lookups', lookups],
                ]),
                callback,
            );
        /**
         * A connection of its own, since a pooled one makes no lookup.
         * @param {string} url
         * @param {import('node:http').RequestOptions} [options]
         */
        const getOwnConnection = (url, options = {}) =>
            new Promise(resolve => {
                get(url, { agent: false, ...options }, res => res.resume().on('close', resolve)).on(
                    'error',
                    resolve,
                );
            });

        beforeEach(() => {
            timings = [];
            lookups = [];
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

        it('should record no lookup for a host that is an IP address', async () => {
            await inRequest(() => getOwnConnection(`http://127.0.0.1:${port}/ip`));

            expect(timings).toHaveLength(1);
            expect(lookups).toEqual([]);
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
         * localhost resolves to two addresses, and the socket emits 'lookup'
         * for each one; it is still one lookup.
         */
        it("should record a DNS lookup against the request, and log it through the request's logger", async () => {
            await inRequest(() => getOwnConnection(`http://localhost:${port}/lookup`));

            expect(lookups).toStrictEqual([{ host: 'localhost', duration: expect.any(Number) }]);
            expect(logger.info).toHaveBeenCalledWith(
                { entry: 'DNS Lookup: localhost', duration: expect.any(Number), error: undefined },
                'Performance Measurement',
            );
            expect(loggedFields('DNS Lookup: localhost')).toBeUndefined();
        });

        it('should record the lookup a fetch or a node:http2 session makes', async () => {
            await inRequest(async () => {
                await (await fetch(`http://localhost:${port}/lookup/fetch`)).text();
                const session = connect(`http://localhost:${http2Port}`);
                const stream = session.request({ ':path': '/lookup/http2' });

                stream.resume();
                await once(stream, 'close');
                session.close();
            });

            expect(lookups).toStrictEqual([
                { host: 'localhost', duration: expect.any(Number) },
                { host: 'localhost', duration: expect.any(Number) },
            ]);
        });

        /**
         * Over TLS, each client looks the host up on the socket it then wraps.
         * The hostname is localhost because the existing HTTPS tests dial
         * 127.0.0.1, which needs no lookup.
         */
        it('should record the lookup each client makes over TLS', async () => {
            const origin = `https://localhost:${securePort}`;

            await inRequest(async () => {
                await new Promise((resolve, reject) => {
                    getSecure(`${origin}/lookup/https`, { agent: false }, res =>
                        res.resume().on('close', resolve),
                    ).on('error', reject);
                });
                const session = connect(origin);
                const stream = session.request({ ':path': '/lookup/http2' });

                stream.resume();
                await once(stream, 'close');
                session.close();
                // fetch negotiates HTTP/2 with this server
                await (await fetch(`${origin}/lookup/fetch`)).text();
            });

            expect(lookups).toStrictEqual([
                { host: 'localhost', duration: expect.any(Number) },
                { host: 'localhost', duration: expect.any(Number) },
                { host: 'localhost', duration: expect.any(Number) },
            ]);
        });

        it('should let go of a socket that connects without a lookup', async () => {
            /** @type {import('node:net').Socket | undefined} */
            let socket;

            await inRequest(
                () =>
                    new Promise(resolve => {
                        get(`http://127.0.0.1:${port}/no-lookup`, { agent: false }, res => {
                            socket = res.socket;
                            res.resume().on('close', resolve);
                        });
                    }),
            );

            expect(socket?.listenerCount('lookup')).toBe(0);
            expect(lookups).toEqual([]);
        });

        it('should record a failed lookup with its error, and the request it failed', async () => {
            await inRequest(() =>
                getOwnConnection(`http://localhost:${port}/lookup/failed`, {
                    lookup: failingLookup,
                }),
            );

            expect(lookups).toStrictEqual([
                {
                    host: 'localhost',
                    duration: expect.any(Number),
                    error: 'getaddrinfo ENOTFOUND localhost',
                },
            ]);
            expect(timings).toStrictEqual([
                {
                    host: `localhost:${port}`,
                    duration: expect.any(Number),
                    error: 'getaddrinfo ENOTFOUND localhost',
                },
            ]);
            expect(logger.info).toHaveBeenCalledWith(
                {
                    entry: 'DNS Lookup: localhost',
                    duration: expect.any(Number),
                    error: 'getaddrinfo ENOTFOUND localhost',
                },
                'Performance Measurement',
            );
        });

        it('should not record a lookup that completes after being disabled', async () => {
            await inRequest(() =>
                getOwnConnection(`http://localhost:${port}/lookup/disabled`, {
                    lookup: (hostname, options, callback) => {
                        performanceHook.disable();
                        dnsLookup(hostname, options, callback);
                    },
                }),
            );

            expect(lookups).toEqual([]);
            expect(logger.info).not.toHaveBeenCalled();
        });

        it('should record without logging when each request is not logged', async () => {
            performanceHook.disable();
            performanceHook.enable({ log: false });

            await inRequest(async () => {
                await (await fetch(`http://127.0.0.1:${port}/quiet`)).text();
                await getOwnConnection(`http://localhost:${port}/lookup/quiet`);
            });
            await new Promise(resolve => setTimeout(resolve, 10));

            expect(timings).toHaveLength(2);
            expect(lookups).toHaveLength(1);
            expect(logger.info).not.toHaveBeenCalled();
            expect(log.info).not.toHaveBeenCalled();
        });
    });

    it('should time node:http to its response headers and body, and its DNS lookup', async () => {
        await new Promise(resolve => {
            // A connection of its own, since a pooled one makes no lookup
            get(`http://localhost:${port}/http?q=1`, { agent: false }, res =>
                res.resume().on('end', resolve),
            );
        });

        expectHeadersThenBody(loggedFields(`HTTP Request: GET http://localhost:${port}/http?q=1`));
        expect(loggedFields('DNS Lookup: localhost')?.duration).toEqual(expect.any(Number));
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
        await (await fetch(`http://localhost:${port}/lookup/timeline`)).text();

        expect(loggedFields('DNS Lookup: localhost')).toBeDefined();
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

    /** Logging changes with another enable(); disable() drops what is in flight. */
    it('should not log a request that started before logging was turned on', async () => {
        performanceHook.disable();
        performanceHook.enable({ log: false });

        await new Promise(resolve => {
            get(`http://127.0.0.1:${port}/turned-on`, { agent: false }, res => {
                performanceHook.enable();
                res.resume().on('close', resolve);
            });
        });

        expect(log.info).not.toHaveBeenCalled();
    });

    it('should not log a lookup that started before logging was turned on', async () => {
        performanceHook.disable();
        performanceHook.enable({ log: false });

        await new Promise(resolve => {
            get(
                `http://localhost:${port}/lookup/turned-on`,
                {
                    agent: false,
                    lookup: (hostname, options, callback) => {
                        performanceHook.enable();
                        dnsLookup(hostname, options, callback);
                    },
                },
                res => res.resume().on('close', resolve),
            );
        });

        expect(loggedFields('DNS Lookup: localhost')).toBeUndefined();
    });

    it('should time each lookup once, however often it is enabled', async () => {
        performanceHook.enable();

        await new Promise(resolve => {
            get(`http://localhost:${port}/lookup/twice`, { agent: false }, res =>
                res.resume().on('close', resolve),
            );
        });

        expect(
            vi
                .mocked(log.info)
                .mock.calls.filter(([{ entry }]) => entry === 'DNS Lookup: localhost'),
        ).toHaveLength(1);
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

describe('logsEach', () => {
    it.each([
        ['true', 'production', true],
        ['true', 'development', true],
        ['false', 'production', false],
        ['false', 'development', false],
        [undefined, 'production', false],
        [undefined, 'development', true],
        [undefined, 'test', false],
        ['yes', 'production', false],
        ['yes', 'development', true],
    ])(
        'with PERFORMANCE_LOG=%s under NODE_ENV=%s, should be %s',
        (PERFORMANCE_LOG, NODE_ENV, expected) => {
            expect(logsEach({ PERFORMANCE_LOG, NODE_ENV })).toBe(expected);
        },
    );
});
