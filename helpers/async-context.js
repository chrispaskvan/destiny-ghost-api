// @ts-check
import { AsyncLocalStorage } from 'node:async_hooks';

/**
 * One outbound HTTP request, or one DNS lookup, made while handling an
 * inbound one. `error` is present only when it failed, and may be empty:
 * `new Error()` and some socket resets carry no message. A request's `host`
 * is the URL's, port included; a lookup's is the hostname it resolved.
 * @typedef {{ host: string, duration: number, error?: string }} Timing
 */

/**
 * Holds what helpers/log.js's contextMiddleware sets up for each request:
 * 'logger', the request-scoped child logger read back by log.js's Proxy and
 * by call sites wanting the traceId off its bindings(), and 'timings' and
 * 'lookups', the outbound requests and DNS lookups helpers/performance.js
 * records and helpers/httpLog.js summarizes.
 * @type {AsyncLocalStorage<Map<'logger', import('pino').Logger> & Map<'timings' | 'lookups', Timing[]>>}
 */
const context = new AsyncLocalStorage();

export default context;
