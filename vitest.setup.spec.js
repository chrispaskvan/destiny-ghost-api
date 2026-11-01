import net from 'node:net';
import tls from 'node:tls';
import { afterEach, describe, expect, it } from 'vitest';

/**
 * The connection guard in `vitest.setup.js` (#783). Each test opens a socket
 * to a TEST-NET-3 address (RFC 5737, never routed) and destroys it at once,
 * then takes what the guard recorded - clearing it, so this spec does not
 * fail its own guard.
 */
const state = globalThis[Symbol.for('destiny-ghost.unit-spec-connections')];
const REMOTE = '203.0.113.1';

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

describe('unit spec connection guard', () => {
    afterEach(() => {
        state.connections = [];
    });

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
        expect(connections[0]).toMatch(/^port 6379 from .*vitest\.setup\.spec\.js/);
    });

    it('records a TLS connection once', () => {
        const connections = recordedBy(tls.connect({ host: REMOTE, port: 6380 }));

        expect(connections).toEqual([expect.stringMatching(/^port 6380 /)]);
    });

    it.each([
        ['localhost', () => net.connect(6379, 'localhost')],
        ['127.0.0.1', () => net.createConnection({ host: '127.0.0.1', port: 6379 })],
        ['::1', () => net.connect({ host: '::1', port: 6379 })],
        ['the default host', () => net.connect(6379)],
    ])('ignores a connection to %s', (_, connect) => {
        expect(recordedBy(connect())).toEqual([]);
    });
});
