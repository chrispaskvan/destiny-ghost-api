import net from 'node:net';
import tls from 'node:tls';
import { afterEach, describe, expect, it } from 'vitest';
import { LOOPBACK, NOCK_ALLOWED, policyFor } from './vitest.allowlist.js';

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
 * A `lookup` answering every name with one IPv4 address, in either of the
 * shapes Node asks for: an array when `options.all` is set (as it is with
 * `autoSelectFamily`), otherwise an address and family.
 * @param {string} address
 * @returns {(hostname: string, options: { all?: boolean }, callback: Function) => void}
 */
const lookupTo = address => (_hostname, options, callback) =>
    options?.all ? callback(null, [{ address, family: 4 }]) : callback(null, address, 4);

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

describe('policyFor', () => {
    const unit = policyFor('/repo/helpers/cache.spec.js');
    const integration = policyFor('/repo/users/user.routes.test.js');

    it('holds a unit spec to loopback, whatever the Redis host, without arming nock', () => {
        expect(unit.integration).toBe(false);
        expect(unit.allowedHosts('cache.example.net')).toBe(LOOPBACK);
        expect(unit.failure(2)).toMatch(/^A unit spec opened 2 network connection\(s\).*#783/);
    });

    it('holds an integration test to loopback and the lower-cased Redis host, arming nock', () => {
        expect(integration.integration).toBe(true);
        expect([...integration.allowedHosts('Cache.Example.NET')]).toEqual([
            ...LOOPBACK,
            'cache.example.net',
        ]);
        expect(integration.failure(3)).toMatch(
            /^An integration test opened 3 connection\(s\).*#784/,
        );
    });

    it('holds an integration test without a Redis host to loopback', () => {
        expect([...integration.allowedHosts(undefined)]).toEqual([...LOOPBACK]);
    });

    it('has no policy for any other file', () => {
        expect(policyFor('/repo/helpers/itif.js')).toBeUndefined();
    });
});

describe('NOCK_ALLOWED', () => {
    it.each(['127.0.0.1', '127.0.0.1:65534'])('lets %s through', host => {
        expect(NOCK_ALLOWED.test(host)).toBe(true);
    });

    it.each(['127.0.0.10:80', '127.0.0.1.nip.io:443', '127a0b0c1.example:443', 'localhost:80'])(
        'refuses %s',
        host => {
            expect(NOCK_ALLOWED.test(host)).toBe(false);
        },
    );
});

describe('integration test allowlist', () => {
    const integrationAllowlist = () =>
        policyFor('/repo/users/user.routes.test.js').allowedHosts('Cache.Example.NET');

    it('ignores a dial to the Redis host, whatever its case', () => {
        state.allowedHosts = integrationAllowlist();

        expect(
            recordedBy(
                tls.connect({ host: 'Cache.Example.NET', port: 10000, lookup: lookupTo(REMOTE) }),
            ),
        ).toEqual([]);
    });

    it("ignores nock's simulated dial, which carries the interceptor's mockLookup", () => {
        // Named like the interceptor's own: the guard goes by the function's name.
        const answer = lookupTo('127.0.0.1');
        const mockLookup = (hostname, options, callback) => answer(hostname, options, callback);

        state.allowedHosts = integrationAllowlist();
        expect(
            recordedBy(tls.connect({ host: 'www.bungie.net', port: 443, lookup: mockLookup })),
        ).toEqual([]);
    });

    it('records a dial with any other lookup, before it has connected', () => {
        state.allowedHosts = integrationAllowlist();
        expect(
            recordedBy(
                tls.connect({ host: 'www.bungie.net', port: 443, lookup: lookupTo(REMOTE) }),
            ),
        ).toEqual([expect.stringMatching(/^www\.bungie\.net port 443 /)]);
    });
});
