import net from 'node:net';
import tls from 'node:tls';
import { afterEach, describe, expect, it } from 'vitest';

/**
 * The connection guard in `vitest.setup.js` (#783, #784). Each test opens a
 * socket to a TEST-NET-3 address (RFC 5737, never routed) and destroys it at
 * once, then takes what the guard recorded - clearing it, so this spec does
 * not fail its own guard.
 */
const state = globalThis[Symbol.for('destiny-ghost.connection-guard')];
const REMOTE = '203.0.113.1';
const specAllowlist = state.allowedHosts;

/**
 * @param {net.Socket} socket
 * @returns {string[]}
 */
const recordedBy = socket => {
    socket.on('error', () => {});
    socket.destroy();

    const { connections } = state;

    state.connections = [];

    return connections;
};

/**
 * @param {string} address
 * @returns {(hostname: string, options: object, callback: Function) => void}
 */
const lookupTo = address => (_hostname, _options, callback) => callback(null, address, 4);

afterEach(() => {
    state.allowedHosts = specAllowlist;
    state.connections = [];
});

describe('unit spec allowlist', () => {
    it.each([
        ['net.connect(options)', () => net.connect({ host: REMOTE, port: 6379 })],
        ['net.connect(port, host)', () => net.connect(6379, REMOTE)],
        ['net.createConnection(options)', () => net.createConnection({ host: REMOTE, port: 6379 })],
        ['net.createConnection(port, host)', () => net.createConnection(6379, REMOTE)],
        ['Socket#connect(options)', () => new net.Socket().connect({ host: REMOTE, port: 6379 })],
        ['Socket#connect(port, host)', () => new net.Socket().connect(6379, REMOTE)],
    ])('records a remote connection made with %s', (_, connect) => {
        const connections = recordedBy(connect());

        expect(connections).toHaveLength(1);
        expect(connections[0]).toMatch(/^203\.0\.113\.1 port 6379 from .*vitest\.setup\.spec\.js/);
    });

    it('records a TLS connection once', () => {
        const connections = recordedBy(tls.connect({ host: REMOTE, port: 6380 }));

        expect(connections).toEqual([expect.stringMatching(/^203\.0\.113\.1 port 6380 /)]);
    });

    it.each([
        ['localhost', () => net.connect(6379, 'localhost')],
        ['127.0.0.1', () => net.createConnection({ host: '127.0.0.1', port: 6379 })],
        ['::1', () => net.connect({ host: '::1', port: 6379 })],
        ['the default host', () => net.connect(6379)],
    ])('ignores a connection to %s', (_, connect) => {
        expect(recordedBy(connect())).toEqual([]);
    });

    it('records nothing outside a test file', () => {
        state.allowedHosts = undefined;

        expect(recordedBy(net.connect({ host: REMOTE, port: 443 }))).toEqual([]);
    });
});

describe('integration test allowlist', () => {
    it('ignores a dial to an allowed host, whatever its case', () => {
        state.allowedHosts = new Set(['localhost', 'cache.example.net']);

        expect(
            recordedBy(
                tls.connect({ host: 'Cache.Example.NET', port: 10000, lookup: lookupTo(REMOTE) }),
            ),
        ).toEqual([]);
    });

    it("ignores nock's simulated dial, which carries the interceptor's mockLookup", () => {
        // Named like the interceptor's own: the guard goes by the function's name.
        const mockLookup = (_hostname, _options, callback) => callback(null, '127.0.0.1', 4);

        expect(
            recordedBy(tls.connect({ host: 'www.bungie.net', port: 443, lookup: mockLookup })),
        ).toEqual([]);
    });

    it('records a dial with any other lookup, before it has connected', () => {
        expect(
            recordedBy(
                tls.connect({ host: 'www.bungie.net', port: 443, lookup: lookupTo(REMOTE) }),
            ),
        ).toEqual([expect.stringMatching(/^www\.bungie\.net port 443 /)]);
    });
});
