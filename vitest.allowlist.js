// @ts-check
/**
 * Which hosts a test file may connect to, for the connection guard in
 * `vitest.setup.js` (#783, #784). Kept apart from the setup file so its spec
 * can exercise the integration-test rules without being an integration test.
 */

/** Hosts that never leave the machine, as `Socket#connect` sees them. */
export const LOOPBACK = new Set([undefined, '', 'localhost', '127.0.0.1', '::1', '0.0.0.0', '::']);

/**
 * The hosts nock lets an integration test reach over HTTP. nock tests it
 * against `host:port`, and turns a string matcher into an unanchored RegExp,
 * so a plain `'127.0.0.1'` would also let `127.0.0.10` or `127.0.0.1.nip.io`
 * through.
 */
export const NOCK_ALLOWED = /^127\.0\.0\.1(:\d+)?$/;

/**
 * The allowlist for a test file: loopback for a unit spec, loopback and the
 * Redis host for an integration test, none for anything else. Hosts are
 * lower-cased, as DNS names are case-insensitive and node-redis dials the
 * one its URL parser lower-cased.
 * @param {string} testPath
 * @param {unknown} [redisHost] - `configuration.redis.host`; only read for an integration test
 * @returns {Set<unknown> | undefined}
 */
export const allowlistFor = (testPath, redisHost) => {
    if (testPath.endsWith('.spec.js')) {
        return LOOPBACK;
    }

    if (testPath.endsWith('.test.js')) {
        return new Set([
            ...LOOPBACK,
            typeof redisHost === 'string' ? redisHost.toLowerCase() : redisHost,
        ]);
    }

    return undefined;
};
