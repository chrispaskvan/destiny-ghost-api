// @ts-check
import { AsyncLocalStorage } from 'node:async_hooks';

/**
 * Only ever holds a 'logger' key mapping to the request-scoped child logger
 * helpers/log.js's contextMiddleware creates, read back by log.js's Proxy
 * and by call sites wanting the traceId off its bindings().
 * @type {AsyncLocalStorage<Map<'logger', import('pino').Logger>>}
 */
const context = new AsyncLocalStorage();

export default context;
