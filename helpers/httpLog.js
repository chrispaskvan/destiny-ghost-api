/**
 * A module for logging web requests and their corresponding responses.
 *
 * @module Log
 * @summary Log request and response.
 * @author Chris Paskvan
 * @description Logging provider for recording requests and responses.
 * @requires pino
 * @requires cuid
 */
import PinoHttp from 'pino-http';
import { createId } from '@paralleldrive/cuid2';
import { stdSerializers } from 'pino';
import context from './async-context';
import log from './log';

class HttpLog extends PinoHttp {
    constructor() {
        super({
            customErrorObject: (_req, _res, _err, loggableObject) => {
                const { traceId } = context.getStore()?.get('logger')?.bindings() || {};

                return {
                    traceId,
                    ...loggableObject,
                };
            },
            customReceivedObject: (req, res, loggableObject) => {
                const { session: { displayName, membershipType }, body: { From: phoneNumber } = {} } = req;
                const { traceId } = context.getStore()?.get('logger')?.bindings() || {};

                res.setHeader('X-Trace-Id', traceId);

                return {
                    displayName,
                    membershipType,
                    phoneNumber,
                    traceId,
                    ...loggableObject,
                };
            },
            customSuccessObject: (_req, _res, loggableObject) => {
                const { traceId } = context.getStore()?.get('logger')?.bindings() || {};

                return {
                    traceId,
                    ...loggableObject,
                };
            },
            genReqId: (req, res) => {
                let requestId = req.headers['x-request-id'];

                requestId ||= createId();
                res.setHeader('X-Request-Id', requestId);

                return requestId;
            },
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
