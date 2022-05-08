/**
 * A module for logging messages.
 *
 * @module log
 * @author Chris Paskvan
 * @requires cuid
 * @requires pino
 */
const pino = require('pino');

let log;

if (process.env.NODE_ENV === 'test') {
    log = console;
} else if (process.env.NODE_ENV === 'production') {
    log = pino();
} else {
    log = pino({
        transport: {
            target: 'pino-pretty',
        },
    });
}

module.exports = log;
