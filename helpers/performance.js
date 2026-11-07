// @ts-check
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
 * Whether each measurement is logged by default: `PERFORMANCE_LOG` when it is
 * `true` or `false`, and otherwise only in development. Every measurement is
 * recorded against its request either way.
 *
 * @param {{ PERFORMANCE_LOG?: string, NODE_ENV?: string }} [env]
 */
const logsEach = ({ PERFORMANCE_LOG, NODE_ENV } = process.env) =>
    PERFORMANCE_LOG === 'true' || PERFORMANCE_LOG === 'false'
        ? PERFORMANCE_LOG === 'true'
        : NODE_ENV === 'development';

/**
 * The request-scoped logger, read when a measurement starts, so that it
 * belongs to the request that started it whatever context completes it.
 */
const requestLogger = () => context.getStore()?.get('logger') ?? log;

/**
 * Bumped on disable, so a lookup started before it is dropped when it
 * completes: the socket still holds its listener.
 */
let generation = 0;
/**
 * Times the socket's DNS lookup. Node publishes no diagnostics channel for
 * DNS, but every client socket - node:http, node:https, node:http2 and
 * fetch's - is published on net.client.socket before it looks its host up,
 * and emits 'lookup' once the lookup completes, failed or not.
 *
 * A client that resolves the host itself and dials the address, or hands the
 * socket a `lookup` of its own, is timed by what the socket sees: nothing, or
 * that `lookup`. nodemailer does both, so SMTP lookups are missing or near 0.
 *
 * @param {import('node:net').Socket} socket
 */
const startLookup = socket => {
    const started = generation;
    const start = performance.now();
    const logger = requestLogger();
    const requestLookups = context.getStore()?.get('lookups');
    /**
     * @param {Error | null} error
     * @param {string} _address
     * @param {number} _family
     * @param {string} host
     */
    const complete = (error, _address, _family, host) => {
        socket.off('connect', release);
        if (started !== generation) {
            return;
        }

        const duration = elapsed(start);

        requestLookups?.push({ host, duration, ...(error && { error: error.message }) });
        if (logEach) {
            logger.info(
                { entry: `DNS Lookup: ${host}`, duration, error: error?.message },
                'Performance Measurement',
            );
        }
    };
    // A socket connected without a lookup (to an address) lets go of the
    // request it was opened in
    const release = () => socket.off('lookup', complete);

    // A host with several addresses emits 'lookup' for each one; the first
    // completes the lookup
    socket.once('lookup', complete).once('connect', release);
};

/**
 * @typedef {object} PendingRequest
 * @property {string} [entry] - built only when it will be logged
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
 * cannot see a credential inside the query string of `entry`, which is built
 * only when the request will be logged on its own.
 *
 * @param {object} key
 * @param {string} method
 * @param {string} url
 */
const startRequest = (key, method, url) => {
    requests.set(key, {
        ...(logEach && { entry: `HTTP Request: ${method} ${redactUrl(url)}` }),
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
/**
 * fetch negotiates HTTP/2 when a server offers it - Bungie does - and undici
 * then sends the request on a node:http2 stream, which publishes the http2
 * channels too: one request, timed twice. undici creates that stream in the
 * same synchronous call that publishes undici:client:sendHeaders, so the
 * first stream created before the next microtask is fetch's own, and left to
 * the undici channels, which also carry the time to send.
 */
let sendingOverHttp2 = false;
/** @param {import('node:tls').TLSSocket} [socket] */
const expectHttp2Stream = socket => {
    if (socket?.alpnProtocol === 'h2') {
        sendingOverHttp2 = true;
        queueMicrotask(() => {
            sendingOverHttp2 = false;
        });
    }
};
/** Whether this stream is fetch's, consuming the expectation if so. */
const isFetchStream = () => {
    const isFetch = sendingOverHttp2;

    sendingOverHttp2 = false;

    return isFetch;
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
        // An entry is built only when logging was on as the request started
        if (logEach && request.entry) {
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
 * @typedef {{ request: { method: string, origin: string, path: string }, error: Error, socket?: import('node:tls').TLSSocket }} UndiciMessage
 * @typedef {{ stream: import('node:http2').ClientHttp2Stream, headers: import('node:http2').OutgoingHttpHeaders }} Http2Message
 */
/** @type {Array<[string, (message: any) => void]>} */
const channels = [
    // DNS lookups, from every client
    [
        'net.client.socket',
        /** @param {{ socket: import('node:net').Socket }} message */
        ({ socket }) => startLookup(socket),
    ],
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
        ({ request, socket }) => {
            sendHeaders(request);
            expectHttp2Stream(socket);
        },
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
            if (isFetchStream()) {
                return;
            }
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
     * Times every outbound HTTP request and DNS lookup, recording each
     * against the inbound request that made it so httpLog can summarize them.
     *
     * @param {{ log?: boolean }} [options] - also log each request, and each
     * DNS lookup, as it completes
     */
    enable({ log: logEachRequest = true } = {}) {
        logEach = logEachRequest;
        for (const [name, onMessage] of channels) {
            subscribe(name, onMessage);
        }
    },
    disable() {
        for (const [name, onMessage] of channels) {
            unsubscribe(name, onMessage);
        }
        generation += 1;
        requests = new WeakMap();
    },
};

export { logsEach };
