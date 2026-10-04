// @ts-check
import { createHook } from 'node:async_hooks';
import { subscribe, unsubscribe } from 'node:diagnostics_channel';
import { performance } from 'node:perf_hooks';

import context from './async-context.js';
import log from './log.js';
import { redactUrl } from './redact.js';

/**
 * Durations are computed from `performance.now()` rather than marks and
 * measures, which accumulate on the global performance timeline until
 * cleared and reach a `PerformanceObserver` in batches.
 *
 * @param {number} start
 */
const elapsed = start => Math.round((performance.now() - start) * 1000) / 1000;

/**
 * Whether each measurement is logged on its own, as well as recorded against
 * the request that made it. Set by `enable()`.
 */
let logEach = false;

/**
 * The request-scoped logger, read when a measurement starts. Read when it
 * completes instead, it is whatever context the completing callback runs in:
 * for a DNS lookup, that is none, so the lookup was logged without the
 * traceId of the request that caused it.
 */
const requestLogger = () => context.getStore()?.get('logger') ?? log;

/**
 * Node publishes no diagnostics channel for DNS lookups, so they are the one
 * thing still timed with an async hook. Only enabled when each measurement is
 * logged: an init hook runs for every async resource the process creates.
 * @type {Map<number, { entry: string, start: number, logger: import('pino').Logger }>}
 */
const lookups = new Map();
const hook = createHook({
    init(id, type, _triggerID, resource) {
        if (type === 'GETADDRINFOREQWRAP') {
            lookups.set(id, {
                entry: `DNS Lookup: ${/** @type {{ hostname: string }} */ (resource).hostname}`,
                start: performance.now(),
                logger: requestLogger(),
            });
        }
    },
    destroy(id) {
        const lookup = lookups.get(id);

        if (lookup) {
            lookups.delete(id);
            lookup.logger.info(
                { entry: lookup.entry, duration: elapsed(lookup.start) },
                'Performance Measurement',
            );
        }
    },
});

/**
 * @typedef {object} PendingRequest
 * @property {string} entry
 * @property {string} host
 * @property {number} start
 * @property {import('pino').Logger} logger
 * @property {import('./async-context.js').Timing[]} [timings] - the inbound
 * request's, when there is one
 * @property {number} [timeToSend] - until the request headers were written,
 * which on an undici pool includes waiting for a free connection
 * @property {number} [timeToHeaders]
 */
/**
 * Outbound HTTP requests from any library, keyed by the client's request
 * object. Keyed weakly because a response whose body is never read never
 * completes. Replaced on disable, since a response already past its
 * headers still holds a 'close' listener that would complete it.
 * @type {WeakMap<object, PendingRequest>}
 */
let requests = new WeakMap();
/**
 * The URL is censored here because Pino's redaction works on object paths and
 * cannot see a credential inside the query string of `entry`.
 *
 * @param {object} key
 * @param {string} method
 * @param {string} url
 */
const startRequest = (key, method, url) => {
    requests.set(key, {
        entry: `HTTP Request: ${method} ${redactUrl(url)}`,
        host: URL.parse(url)?.host ?? '',
        start: performance.now(),
        logger: requestLogger(),
        timings: context.getStore()?.get('timings'),
    });
};
/**
 * undici publishes this once a connection is free and the request is written
 * to it, so the time before it is spent in the pool (and connecting) and the
 * time after it is the server's.
 *
 * @param {object} key
 */
const sendHeaders = key => {
    const request = requests.get(key);

    if (request) {
        request.timeToSend = elapsed(request.start);
    }
};
/** @param {object} key */
const receiveHeaders = key => {
    const request = requests.get(key);

    if (request) {
        request.timeToHeaders = elapsed(request.start);
    }
};
/**
 * @param {object} key
 * @param {Error} [error]
 */
const completeRequest = (key, error) => {
    const request = requests.get(key);

    if (request) {
        const duration = elapsed(request.start);

        requests.delete(key);
        request.timings?.push({
            host: request.host,
            duration,
            ...(error && { error: error.message }),
        });
        if (logEach) {
            request.logger.info(
                {
                    entry: request.entry,
                    timeToSend: request.timeToSend,
                    timeToHeaders: request.timeToHeaders,
                    duration,
                    error: error?.message,
                },
                'Performance Measurement',
            );
        }
    }
};

/**
 * Channel messages are typed `unknown`, so each listener casts to the shape
 * its channel publishes.
 * @typedef {import('node:http').ClientRequest} ClientRequest
 * @typedef {import('node:http').IncomingMessage} IncomingMessage
 * @typedef {{ request: ClientRequest, response: IncomingMessage, error: Error }} HttpMessage
 * @typedef {{ request: { method: string, origin: string, path: string }, error: Error }} UndiciMessage
 * @typedef {{ stream: import('node:http2').ClientHttp2Stream, headers: import('node:http2').OutgoingHttpHeaders }} Http2Message
 */
/** @type {Array<[string, (message: any) => void]>} */
const channels = [
    // node:http and node:https (axios, Twilio, Cosmos, Application Insights, ...)
    [
        'http.client.request.start',
        /** @param {HttpMessage} message */
        ({ request }) =>
            startRequest(
                request,
                request.method,
                `${request.protocol}//${request.getHeader('host')}${request.path}`,
            ),
    ],
    [
        'http.client.response.finish',
        /** @param {HttpMessage} message */
        ({ request, response }) => {
            receiveHeaders(request);
            // 'close' rather than 'end', which a reset after the headers
            // never emits; no 'error' listener, since adding one would stop
            // an error the caller doesn't handle from being thrown
            response.once('close', () => completeRequest(request, response.errored ?? undefined));
        },
    ],
    [
        'http.client.request.error',
        /** @param {HttpMessage} message */
        ({ request, error }) => completeRequest(request, error),
    ],
    // fetch (undici)
    [
        'undici:request:create',
        /** @param {UndiciMessage} message */
        ({ request }) => startRequest(request, request.method, `${request.origin}${request.path}`),
    ],
    [
        'undici:client:sendHeaders',
        /** @param {UndiciMessage} message */
        ({ request }) => sendHeaders(request),
    ],
    [
        'undici:request:headers',
        /** @param {UndiciMessage} message */
        ({ request }) => receiveHeaders(request),
    ],
    [
        'undici:request:trailers',
        /** @param {UndiciMessage} message */
        ({ request }) => completeRequest(request),
    ],
    [
        'undici:request:error',
        /** @param {UndiciMessage} message */
        ({ request, error }) => completeRequest(request, error),
    ],
    // node:http2 (gRPC clients)
    [
        'http2.client.stream.created',
        /** @param {Http2Message} message */
        ({ stream, headers }) => {
            startRequest(
                stream,
                String(headers[':method']),
                `${headers[':scheme']}://${headers[':authority']}${headers[':path']}`,
            );
            // The stream's own 'close' rather than the close channel, which
            // is published before a reset's error and would log a success
            stream.once('close', () => completeRequest(stream, stream.errored ?? undefined));
        },
    ],
    [
        'http2.client.stream.finish',
        /** @param {Http2Message} message */
        ({ stream }) => receiveHeaders(stream),
    ],
];

export default {
    /**
     * Times every outbound HTTP request, recording each against the inbound
     * request that made it so httpLog can summarize them.
     *
     * @param {{ log?: boolean }} [options] - also log each request, and each
     * DNS lookup, as it completes
     */
    enable({ log: logEachRequest = true } = {}) {
        logEach = logEachRequest;
        if (logEach) {
            hook.enable();
        }
        for (const [name, onMessage] of channels) {
            subscribe(name, onMessage);
        }
    },
    disable() {
        hook.disable();
        for (const [name, onMessage] of channels) {
            unsubscribe(name, onMessage);
        }
        lookups.clear();
        requests = new WeakMap();
    },
};
