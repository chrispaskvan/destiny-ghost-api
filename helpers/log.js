/**
 * A module for logging messages.
 *
 * @module log
 * @author Chris Paskvan
 * @requires cuid
 * @requires pino
 */
// @ts-check
import { createId } from '@paralleldrive/cuid2';
import pino from 'pino';
import context from './async-context.js';
import redact from './redact.js';

const productionOnlyOptions = {
    formatters: {
        level: (/** @type {string} */ label) => ({ level: label.toUpperCase() }),
    },
    timestamp: pino.stdTimeFunctions.isoTime,
};
/** @type {import('pino').LoggerOptions} */
let options;
const unsupportedWorkerExecArgvPrefixes = ['--max-old-space-size', '--disable-proto='];
/** @param {string[]} execArgv */
const getWorkerExecArgv = execArgv =>
    execArgv.filter(
        arg => !unsupportedWorkerExecArgvPrefixes.some(prefix => arg.startsWith(prefix)),
    );

if (process.env.NODE_ENV !== 'production') {
    options = {
        transport: {
            target: 'pino-pretty',
            worker: {
                // Worker threads do not support all process-level Node flags.
                execArgv: getWorkerExecArgv(process.execArgv),
            },
        },
        ...productionOnlyOptions,
    };
} else {
    options = productionOnlyOptions;
}

/**
 * Redaction is applied here rather than on either branch above because it
 * belongs to the root logger in both: Pino runs it after the serializers and
 * across every child, making it the one hook that sees both what a call site
 * passes and what a serializer produces from a raw request.
 */
const logger = pino({ ...options, redact });
const log = new Proxy(logger, {
    get(target, property, receiver) {
        target = context.getStore()?.get('logger') || target;

        return Reflect.get(target, property, receiver);
    },
});
/**
 * @param {import('express').Request} _req
 * @param {import('express').Response} _res
 * @param {import('express').NextFunction} next
 */
const contextMiddleware = (_req, _res, next) => {
    const child = logger.child({ traceId: createId() });
    const store = new Map();

    store.set('logger', child);
    store.set('timings', []);
    store.set('lookups', []);

    return context.run(store, next);
};

/**
 * Run `fn` with a child of the root logger as the context logger, so every
 * line logged through `log` while it runs carries `bindings`, the way a
 * request's lines carry its traceId. For work outside a request, such as a
 * queued job.
 *
 * The child is made from the root logger, never from `log`: a Pino child's
 * prototype is the logger `child()` was called on, so a child of the proxy,
 * once it is the context logger, would look its methods up through the
 * proxy, which hands back the same child, until the stack overflows.
 * @template T
 * @param {Record<string, unknown>} bindings
 * @param {() => T} fn
 * @returns {T}
 */
const runWithBindings = (bindings, fn) => {
    const store = new Map();

    store.set('logger', logger.child(bindings));

    return context.run(store, fn);
};

export default log;
export { contextMiddleware, getWorkerExecArgv, runWithBindings };
