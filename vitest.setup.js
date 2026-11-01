// @ts-check
/**
 * Holds each test file to an allowlist of hosts it may connect to.
 *
 * Unit specs (`*.spec.js`, #783) may reach only loopback. They run with their
 * dependencies mocked (AGENTS.md), so one that connects anywhere else has
 * reached a real service - most often the shared Redis, through a module that
 * connects as it is imported (`helpers/cache.js`, `helpers/jobs.js`). That
 * makes the suite depend on the network and on what that service holds, and
 * an open client can keep a worker alive after its tests have finished.
 *
 * Integration tests (`*.test.js`, #784) start a real server, which reaches the
 * shared Redis by design, so they may reach loopback and the configured Redis
 * host. nock is armed here before the test file loads, refusing every HTTP
 * request but one to 127.0.0.1, so the server's startup calls are fenced too.
 *
 * Connections are recorded, not refused: refusing one would send the client
 * into its reconnect loop, which is its own way of keeping a worker alive.
 * The file fails once it has finished, naming what connected and from where.
 *
 * nock's simulated dials are skipped. For every HTTP request nock handles or
 * refuses, its interceptor (`@mswjs/interceptors`) dials a mock socket through
 * this same `Socket#connect`, with its own `lookup` that answers loopback for
 * every name. That socket never reaches the network. A request nock lets
 * through gets a second, real dial without that `lookup`, and that one counts.
 * Telling them apart at call time, rather than by waiting for the `connect`
 * event, keeps a dial still connecting at the end of the file from being
 * missed. If a nock upgrade renames the mock lookup, every request nock stops
 * starts failing its file loudly, rather than the guard passing quietly.
 */
import net from 'node:net';
import { beforeAll, expect } from 'vitest';
import { allowlistFor, NOCK_ALLOWED } from './vitest.allowlist.js';

const STATE = Symbol.for('destiny-ghost.connection-guard');

/**
 * @typedef {Object} State
 * @property {string[]} connections - dials outside the allowlist
 * @property {Set<unknown> | undefined} allowedHosts - lower-cased; unset outside test files
 */

/** @type {State} */
const state = /** @type {any} */ (globalThis)[STATE] ?? {
    connections: [],
    allowedHosts: undefined,
};

/**
 * The host and port a connection was asked for, from either the
 * options-object or the `(port, host)` form. `net.connect()`,
 * `net.createConnection()` and `tls.connect()` all end up in `Socket#connect`,
 * the first two passing their arguments already normalized into an
 * `[options, callback]` array - which is how ioredis connects. The host is
 * lower-cased, as DNS names are case-insensitive and node-redis dials the one
 * its URL parser lower-cased.
 * @param {unknown[]} args
 * @returns {{ host: unknown, port: unknown, simulated: boolean }}
 */
const connectionOf = args => {
    const [first, second] = Array.isArray(args[0]) ? args[0] : args;
    const { host, lookup, port, path } =
        first && typeof first === 'object'
            ? /** @type {{ host?: unknown, lookup?: unknown, port?: unknown, path?: unknown }} */ (
                  first
              )
            : {
                  host: typeof second === 'string' ? second : undefined,
                  lookup: undefined,
                  port: first,
                  path: undefined,
              };

    return {
        host: path ? 'localhost' : typeof host === 'string' ? host.toLowerCase() : host,
        port: port ?? path,
        simulated: typeof lookup === 'function' && lookup.name === 'mockLookup',
    };
};

/**
 * The repository's own frames that led to a connection.
 * @returns {string}
 */
const callSite = () =>
    (new Error().stack ?? '')
        .split('\n')
        .slice(2)
        .filter(line => !line.includes('node_modules') && !line.includes('node:'))
        .map(line => line.trim().replace(/^at /, ''))
        .filter(line => !line.includes('vitest.setup.js'))
        .slice(0, 3)
        .join(' <- ') || 'a dependency';

/**
 * @template {(...args: any[]) => any} F
 * @param {F} original
 * @returns {F}
 */
const recorded = original =>
    /** @type {F} */ (
        /** @this {unknown} */
        function (/** @type {unknown[]} */ ...args) {
            const { allowedHosts } = state;

            if (allowedHosts) {
                const { host, port, simulated } = connectionOf(args);

                if (!simulated && !allowedHosts.has(host)) {
                    state.connections.push(
                        `${String(host)} port ${String(port)} from ${callSite()}`,
                    );
                }
            }

            return original.apply(this, args);
        }
    );

if (!(/** @type {any} */ (globalThis)[STATE])) {
    /** @type {any} */ (globalThis)[STATE] = state;
    net.Socket.prototype.connect = recorded(net.Socket.prototype.connect);
}

const testPath = String(expect.getState().testPath ?? '');
/** @type {string | undefined} */
let failure;

state.allowedHosts = undefined;
state.connections = [];

if (testPath.endsWith('.spec.js')) {
    state.allowedHosts = allowlistFor(testPath);
    failure = 'A unit spec opened {count} network connection(s); mock what connects (#783)';
}

if (testPath.endsWith('.test.js')) {
    // Imported only here: config reads `settings/` as it loads, which unit specs never need.
    const [{ default: configuration }, { default: nock }] = await Promise.all([
        import('./helpers/config.js'),
        import('nock'),
    ]);

    nock.disableNetConnect();
    nock.enableNetConnect(NOCK_ALLOWED);
    state.allowedHosts = allowlistFor(testPath, configuration.redis?.host);
    failure =
        'An integration test opened {count} connection(s) outside its allowlist (loopback, Redis); intercept them with nock or a mock, or allow and document them (#784)';
}

if (failure) {
    const message = failure;

    /**
     * Checked in a `beforeAll` cleanup, not an `afterAll`: with
     * `sequence.hooks: 'parallel'` an `afterAll` here would run alongside the
     * file's own, such as an integration test's `stopServer()`, missing
     * anything dialed during shutdown. Vitest runs `beforeAll` cleanups only
     * once every `afterAll` has finished.
     */
    beforeAll(() => () => {
        const { connections } = state;

        state.connections = [];

        if (connections.length) {
            throw new Error(
                `${message.replace('{count}', String(connections.length))}:\n  ${[
                    ...new Set(connections),
                ].join('\n  ')}`,
            );
        }
    });
}
