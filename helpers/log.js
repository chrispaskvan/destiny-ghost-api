/**
 * A module for logging messages.
 *
 * @module log
 * @author Chris Paskvan
 * @requires cuid
 * @requires pino
 */
const pino = require('pino');

const log = pino({
    prettyPrint: { colorize: true },
});

module.exports = log;
