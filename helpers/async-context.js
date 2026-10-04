// @ts-check
import { AsyncLocalStorage } from 'node:async_hooks';

/**
 * One outbound HTTP request made while handling an inbound one.
 * @typedef {{ host: string, duration: number, error?: string }} Timing
 */

/**
 * Holds what helpers/log.js's contextMiddleware sets up for each request:
 * 'logger', the request-scoped child logger read back by log.js's Proxy and
 * by call sites wanting the traceId off its bindings(), and 'timings', the
 * outbound requests helpers/performance.js records and helpers/httpLog.js
 * summarizes.
 * @type {AsyncLocalStorage<Map<'logger', import('pino').Logger> & Map<'timings', Timing[]>>}
 */
const context = new AsyncLocalStorage();

export default context;
