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
import PinoHttp from 'pino-http';
import cuid from 'cuid';
import { stdSerializers } from 'pino';
import log from './log';

class HttpLog extends PinoHttp {
    constructor() {
        super({
            genReqId: () => cuid(),

            logger: log,

            serializers: {
                err: stdSerializers.err,
                req: stdSerializers.req,
                res: stdSerializers.res,
            },

            useLevel: 'info',
        });
    }
}

export default new HttpLog();
