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
const server = createServer((_req, res) => {
    setTimeout(() => {
        res.writeHead(200);
        res.write('headers sent');
        setTimeout(() => res.end(), bodyDelay);
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

const expectHeadersThenBody = fields => {
    // A millisecond of slack for timer and clock rounding
    expect(fields.timeToHeaders).toBeGreaterThanOrEqual(headersDelay - 1);
    expect(fields.timeToHeaders).toBeLessThan(headersDelay + bodyDelay);
    expect(fields.duration).toBeGreaterThanOrEqual(headersDelay + bodyDelay - 1);
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
