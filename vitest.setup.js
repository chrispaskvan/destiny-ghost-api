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
 * where, so the import can be mocked. Integration tests (`*.test.js`) start a
 * real server, and are not checked.
 */
import net from 'node:net';
import tls from 'node:tls';
import { afterAll, expect } from 'vitest';

const STATE = Symbol.for('destiny-ghost.unit-spec-connections');
const LOOPBACK = new Set([undefined, '', 'localhost', '127.0.0.1', '::1', '0.0.0.0', '::']);

/**
 * @typedef {{ connections: string[] }} State
 * @type {State}
 */
const state = /** @type {any} */ (globalThis)[STATE] ?? { connections: [] };

/**
 * Where a connection was asked for: the host and port, from either the
 * options-object or the `(port, host)` form, and the repository's own frames.
 * @param {unknown[]} args
 * @returns {{ host: unknown, where: string }}
 */
const connectionOf = args => {
    const [first, second] = args;
    const { host, port, path } =
        first && typeof first === 'object'
            ? /** @type {{ host?: unknown, port?: unknown, path?: unknown }} */ (first)
            : {
                  host: typeof second === 'string' ? second : undefined,
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
            const { host, where } = connectionOf(args);

            if (!LOOPBACK.has(/** @type {string | undefined} */ (host))) {
                state.connections.push(where);
            }

            return original.apply(this, args);
        }
    );

if (!(/** @type {any} */ (globalThis)[STATE])) {
    /** @type {any} */ (globalThis)[STATE] = state;
    net.Socket.prototype.connect = recorded(net.Socket.prototype.connect);
    tls.connect = recorded(tls.connect);
}

const testPath = String(expect.getState().testPath ?? '');

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
