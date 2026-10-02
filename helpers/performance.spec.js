import { once } from 'node:events';
import { createServer, get } from 'node:http';
import { connect, createServer as createHttp2Server } from 'node:http2';
import { performance } from 'node:perf_hooks';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
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
const http2Server = createHttp2Server().on('stream', stream => {
    setTimeout(() => {
        stream.respond({ ':status': 200 });
        stream.write('headers sent');
        setTimeout(() => stream.end(), bodyDelay);
    }, headersDelay);
});
let port;
let http2Port;

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
        await Promise.all([once(server, 'listening'), once(http2Server, 'listening')]);
        ({ port } = server.address());
        ({ port: http2Port } = http2Server.address());
    });

    afterAll(() => {
        server.close();
        http2Server.close();
    });

    beforeEach(() => performanceHook.enable());

    afterEach(() => performanceHook.disable());

    it('should time fetch to its response headers and body', async () => {
        await (await fetch(`http://127.0.0.1:${port}/fetch?q=1`)).text();

        expectHeadersThenBody(loggedFields(`HTTP Request: GET http://127.0.0.1:${port}/fetch?q=1`));
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

        for (const url of [
            `http://127.0.0.1:${port}/reset/http`,
            `http://127.0.0.1:${port}/reset/fetch`,
        ]) {
            expect(loggedFields(`HTTP Request: GET ${url}`)).toEqual({
                entry: `HTTP Request: GET ${url}`,
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
});
