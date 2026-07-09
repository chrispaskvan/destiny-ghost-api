/**
 * A circuit-breaker-protected HTTP client for the Bungie web API.
 *
 * @module bungieRequest
 * @summary Wraps the request helper's get/post in a shared opossum circuit breaker.
 * @description All Bungie traffic shares a single breaker: Bungie outages
 * (e.g. maintenance windows) are platform-wide, so pooled failure statistics
 * detect them fastest. Cache-aside reads in the services happen before these
 * functions are called, so cached data keeps serving while the circuit is
 * open; cache misses fail fast with a 503. Known limitation: Bungie sometimes
 * signals maintenance as HTTP 200 with a body ErrorCode of 5 — those surface
 * as DestinyError above this layer and do not trip the breaker.
 */
import CircuitBreaker from 'opossum';
import { StatusCodes } from 'http-status-codes';
import { get as httpGet, post as httpPost } from './request.js';
import ResponseError from './response.error.js';
import configuration from './config.js';
import log from './log.js';

const defaults = {
    errorThresholdPercentage: 50,
    resetTimeout: 30000,
    rollingCountBuckets: 10,
    rollingCountTimeout: 60000,
    timeout: 8000,
    volumeThreshold: 5,
};
const { circuitBreaker: overrides = {} } = configuration;
const options = {
    ...defaults,
    ...overrides,
    // Non-transient responses (4xx other than 408/429) are the caller's
    // problem, not a Bungie outage; they reject but never open the circuit.
    errorFilter: err => err instanceof ResponseError && !err.isTransient,
};
// The breaker owns outage handling, so one quick retry replaces the
// request helper's default ladder of three with long backoff.
const retryDefaults = { baseDelay: 500, maxDelay: 1000, maxRetries: 1 };

const breaker = new CircuitBreaker((fn, ...args) => fn(...args), options);

breaker.on('open', () => log.warn('Bungie circuit breaker opened'));
breaker.on('halfOpen', () => log.info('Bungie circuit breaker half-open; probing'));
breaker.on('close', () => log.info('Bungie circuit breaker closed'));

/**
 * Fire the breaker, translating its open-circuit rejection into a 503 the
 * error middleware understands.
 *
 * @param {Function} fn - Underlying request helper.
 * @param {...*} args - Arguments forwarded to the helper.
 * @returns {Promise<*>}
 */
async function fire(fn, ...args) {
    try {
        return await breaker.fire(fn, ...args);
    } catch (err) {
        if (err.code === 'EOPENBREAKER') {
            err.message = 'Bungie API circuit breaker is open.';
            err.statusCode = StatusCodes.SERVICE_UNAVAILABLE;
        }

        throw err;
    }
}

/**
 * Bound the whole logical call (attempt + backoff + retry) with a signal
 * that actually cancels the socket; opossum's timeout only rejects.
 *
 * @param {object} requestOptions
 * @returns {object}
 */
const withSignal = requestOptions => ({
    signal: AbortSignal.timeout(options.timeout),
    ...requestOptions,
});

/**
 * GET from the Bungie API through the circuit breaker.
 *
 * @param {object} requestOptions - Options for {@link module:helpers/request~get}.
 * @param {boolean} [includeHeaders=false]
 * @param {object} [retryOptions]
 * @returns {Promise<*>}
 */
async function get(requestOptions, includeHeaders = false, retryOptions) {
    return await fire(httpGet, withSignal(requestOptions), includeHeaders, {
        ...retryDefaults,
        ...retryOptions,
    });
}

/**
 * POST to the Bungie API through the circuit breaker.
 *
 * @param {object} requestOptions - Options for {@link module:helpers/request~post}.
 * @param {object} [retryOptions]
 * @returns {Promise<*>}
 */
async function post(requestOptions, retryOptions) {
    return await fire(httpPost, withSignal(requestOptions), {
        ...retryDefaults,
        ...retryOptions,
    });
}

/**
 * Snapshot of the breaker's state and rolling-window statistics.
 *
 * @returns {{ state: string, stats: object }}
 */
function getCircuitBreakerStatus() {
    const state = breaker.opened ? 'open' : breaker.halfOpen ? 'half-open' : 'closed';
    const { failures, rejects, successes, timeouts } = breaker.stats;

    return { state, stats: { failures, rejects, successes, timeouts } };
}

export { breaker, get, getCircuitBreakerStatus, post };
