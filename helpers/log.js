/**
 * A module for logging messages.
 *
 * @module log
 * @author Chris Paskvan
 * @requires cuid
 * @requires pino
 */
import { createId } from '@paralleldrive/cuid2';
import pino from 'pino';
import context from './async-context.js';

const productionOnlyOptions = {
    formatters: {
        level: label => ({ level: label.toUpperCase() }),
    },
    timestamp: pino.stdTimeFunctions.isoTime,
};
let options;

if (process.env.NODE_ENV !== 'production') {
    options = {
        transport: {
            target: 'pino-pretty',
            worker: {
                // Worker threads do not support --max-old-space-size.
                execArgv: process.execArgv.filter(arg => !arg.startsWith('--max-old-space-size')),
            },
        },
        ...productionOnlyOptions,
    };
} else {
    options = productionOnlyOptions;
}

const logger = pino(options);
const log = new Proxy(logger, {
    get(target, property, receiver) {
        target = context.getStore()?.get('logger') || target;

        return Reflect.get(target, property, receiver);
    },
});
const contextMiddleware = (_req, _res, next) => {
    const child = logger.child({ traceId: createId() });
    const store = new Map();

    store.set('logger', child);

    return context.run(store, next);
};

export default log;
export { contextMiddleware };
