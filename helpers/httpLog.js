/**
 * A module for logging web requests and their corresponding responses.
 *
 * @module Log
 * @summary Log request and response.
 * @author Chris Paskvan
 * @description Logging provider for recording requests and responses.
 * Adopted from Eric Elliott's bunyan-request-logger project hosted at
 * {@link https://github.com/ericelliott/bunyan-request-logger} and
 * outlined in detail at {@link http://chimera.labs.oreilly.com/books/1234000000262/ch07.html#logging-requests}.
 * @requires _
 * @requires pino
 * @requires cuid
 */
const PinoHttp = require('pino-http');
const cuid = require('cuid');
const pino = require('pino');
const log = require('./log');

class HttpLog extends PinoHttp {
    constructor() {
        super({
            genReqId: () => cuid(),

            logger: log,

            serializers: {
                err: pino.stdSerializers.err,
                req: pino.stdSerializers.req,
                res: pino.stdSerializers.res,
            },

            useLevel: 'info',
        });
    }
}

module.exports = new HttpLog();
