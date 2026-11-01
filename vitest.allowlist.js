// @ts-check
/**
 * What the connection guard in `vitest.setup.js` holds each test file to
 * (#783, #784). Kept apart from the setup file so its spec can exercise the
 * integration-test rules without being an integration test.
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
 * @typedef {Object} Policy
 * @property {boolean} integration - arm nock and read the Redis host from configuration
 * @property {(redisHost?: unknown) => Set<unknown>} allowedHosts - lower-cased
 * @property {(count: number) => string} failure - the message for `count` stray connections
 */

/** @type {Policy} */
const unitSpec = {
    integration: false,
    allowedHosts: () => LOOPBACK,
    failure: count =>
        `A unit spec opened ${count} network connection(s); mock what connects (#783)`,
};

/**
 * Hosts are lower-cased, as DNS names are case-insensitive and node-redis
 * dials the one its URL parser lower-cased.
 * @type {Policy}
 */
const integrationTest = {
    integration: true,
    allowedHosts: redisHost =>
        new Set([...LOOPBACK, typeof redisHost === 'string' ? redisHost.toLowerCase() : redisHost]),
    failure: count =>
        `An integration test opened ${count} connection(s) outside its allowlist (loopback, Redis); intercept them with nock or a mock, or allow and document them (#784)`,
};

/**
 * The policy for a test file: loopback only for a unit spec, loopback and the
 * Redis host for an integration test, none for anything else.
 * @param {string} testPath
 * @returns {Policy | undefined}
 */
export const policyFor = testPath => {
    if (testPath.endsWith('.spec.js')) {
        return unitSpec;
    }

    if (testPath.endsWith('.test.js')) {
        return integrationTest;
    }

    return undefined;
};
