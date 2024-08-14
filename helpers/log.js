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
import context from './async-context';

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
const contextMiddleware = (req, res, next) => {
    const child = logger.child({ traceId: createId() });
    const store = new Map();

    store.set('logger', child);

    return context.run(store, next);
};

export default log;
export { contextMiddleware };
