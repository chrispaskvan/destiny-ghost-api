// @ts-check
/**
 * Fails a unit spec that opens a network connection (#783).
 *
 * Unit specs (`*.spec.js`) run with their dependencies mocked (AGENTS.md). One
 * that connects anywhere but loopback has reached a real service - most often
 * the shared Redis, through a module that connects as it is imported
 * (`helpers/cache.js`, `helpers/jobs.js`). That makes the suite depend on the
 * network and on what that service holds, and an open client can keep a
 * worker alive after its tests have finished.
 *
 * Connections are recorded, not refused: refusing one would send the client
 * into its reconnect loop, which is its own way of keeping a worker alive.
 * The spec fails once its tests have run, naming what connected and from
 * where, so the import can be mocked.
 *
 * Integration tests (`*.test.js`) start a real server, which reaches the
 * shared Redis by design, so they are held to an allowlist instead (#784):
 * loopback and the configured Redis host. They skip nock's simulated dials.
 * For every HTTP request nock handles or refuses, its interceptor
 * (`@mswjs/interceptors`) dials a mock socket through this same
 * `Socket#connect`, with its own `lookup` that answers loopback for every
 * name. That socket never reaches the network, so counting it would flag
 * every request nock stopped. A request nock lets through gets a second,
 * real dial without that `lookup`, and that one counts.
 *
 * Telling them apart at call time, not by waiting for the `connect` event,
 * keeps a dial that has not finished connecting by `afterAll` from being
 * missed. If a nock upgrade renames the mock lookup, every refused request
 * starts failing the test loudly, rather than the guard passing quietly.
 */
import net from 'node:net';
import { afterAll, expect } from 'vitest';

const STATE = Symbol.for('destiny-ghost.unit-spec-connections');
const LOOPBACK = new Set([undefined, '', 'localhost', '127.0.0.1', '::1', '0.0.0.0', '::']);

/**
 * @typedef {Object} State
 * @property {string[]} connections - connect calls (unit specs)
 * @property {string[]} realConnections - real dials outside the allowlist (integration tests)
 * @property {Set<unknown> | undefined} allowedHosts - set while an integration test runs
 */

/** @type {State} */
const state = /** @type {any} */ (globalThis)[STATE] ?? {
    connections: [],
    realConnections: [],
    allowedHosts: undefined,
};

/**
 * Where a connection was asked for: the host and port, from either the
 * options-object or the `(port, host)` form, and the repository's own frames.
 * `net.connect()`, `net.createConnection()` and `tls.connect()` all end up in
 * `Socket#connect`, the first two passing their arguments already normalized
 * into an `[options, callback]` array - which is how ioredis connects.
 * @param {unknown[]} args
 * @returns {{ host: unknown, simulated: boolean, where: string }}
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
    const frames = (new Error().stack ?? '')
        .split('\n')
        .slice(2)
        .filter(line => !line.includes('node_modules') && !line.includes('node:'))
        .map(line => line.trim().replace(/^at /, ''))
        .filter(line => !line.includes('vitest.setup.js'))
        .slice(0, 3);

    return {
        host: path ? 'localhost' : host,
        simulated: typeof lookup === 'function' && lookup.name === 'mockLookup',
        where: `port ${String(port ?? path)} from ${frames.join(' <- ') || 'a dependency'}`,
    };
};

/**
 * @template {(...args: any[]) => any} F
 * @param {F} original
 * @returns {F}
 */
const recorded = original =>
    /** @type {F} */ (
        /** @this {unknown} */
        function (/** @type {unknown[]} */ ...args) {
            const { host, simulated, where } = connectionOf(args);

            if (!LOOPBACK.has(/** @type {string | undefined} */ (host))) {
                state.connections.push(where);
            }

            if (state.allowedHosts && !simulated && !state.allowedHosts.has(host)) {
                state.realConnections.push(`${String(host)} ${where}`);
            }

            return original.apply(this, args);
        }
    );

if (!(/** @type {any} */ (globalThis)[STATE])) {
    /** @type {any} */ (globalThis)[STATE] = state;
    net.Socket.prototype.connect = recorded(net.Socket.prototype.connect);
}

const testPath = String(expect.getState().testPath ?? '');

state.allowedHosts = undefined;

if (testPath.endsWith('.test.js')) {
    // Imported only here: it reads `settings/` as it loads, which unit specs never need.
    const {
        default: { redis: { host: redisHost } = {} },
    } = await import('./helpers/config.js');

    state.realConnections = [];
    state.allowedHosts = new Set([...LOOPBACK, redisHost]);

    afterAll(() => {
        const { realConnections } = state;

        state.realConnections = [];

        if (realConnections.length) {
            throw new Error(
                `An integration test opened ${realConnections.length} connection(s) outside its allowlist (loopback, Redis); intercept them with nock or a mock, or allow and document them (#784):\n  ${[
                    ...new Set(realConnections),
                ].join('\n  ')}`,
            );
        }
    });
}

if (testPath.endsWith('.spec.js')) {
    state.connections = [];

    afterAll(() => {
        const { connections } = state;

        state.connections = [];

        if (connections.length) {
            throw new Error(
                `A unit spec opened ${connections.length} network connection(s); mock what connects (#783):\n  ${[
                    ...new Set(connections),
                ].join('\n  ')}`,
            );
        }
    });
}
