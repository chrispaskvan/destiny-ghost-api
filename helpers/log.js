/**
 * A module for logging messages.
 *
 * @module log
 * @author Chris Paskvan
 * @requires cuid
 * @requires pino
 */
import pino from 'pino';

// eslint-disable-next-line import/no-mutable-exports
let log;

if (process.env.NODE_ENV === 'production') {
    log = pino();
} else {
    log = pino({
        transport: {
            target: 'pino-pretty',
        },
    });
}

export default log;
