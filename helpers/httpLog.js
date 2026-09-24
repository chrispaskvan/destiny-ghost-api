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
// @ts-check
import { createRequire } from 'node:module';
import { createId } from '@paralleldrive/cuid2';
import { stdSerializers } from 'pino';
import context from './async-context.js';
import log from './log.js';
import { redactQuery, redactUrl } from './redact.js';

/**
 * `pino-http`'s `.d.ts` has no `export =`, so under this project's module
 * resolution (no esModuleInterop) a default import type-checks as the
 * whole module namespace instead of the callable factory - the same issue
 * worked around for `base64url`/`ioredis` elsewhere. `require` sidesteps
 * the mistyped default import.
 * @type {typeof import('pino-http').default}
 */
const PinoHttp = createRequire(import.meta.url)('pino-http');

/**
 * The standard serializer records the request target verbatim, which on the
 * Bungie OAuth callback is `?code=...&state=...` - the authorization code, on
 * the request line, before the route has had a chance to exchange it. It then
 * records Express's parsed `req.query` beside it, which holds the same code
 * again; censoring one without the other accomplishes nothing.
 *
 * Headers need no equivalent pass: `redact` in `log.js` runs after the
 * serializers, so it reaches into this output and censors `authorization`,
 * `cookie` and `set-cookie` by key. The URL and the query are beyond its
 * reach - one because the secret is inside a string rather than at a path,
 * the other because `code` is a credential only here.
 *
 * This takes the *serialized* request, not the raw one: `pino-http` defaults
 * to `wrapSerializers`, which hands a custom serializer the output of
 * `stdSerializers.req` rather than the request itself. Calling that serializer
 * again in here ran it against an object with no `socket`, which silently
 * dropped `remoteAddress` and `remotePort` from every request log.
 *
 * Editing in place keeps the prototype the standard serializer built, whose
 * non-enumerable `raw` getter other `pino-http` options read through. `query`
 * is the exception: the serializer assigns Express's own object by reference,
 * so it is replaced with a censored copy rather than written through to the
 * live request.
 *
 * @param {ReturnType<typeof stdSerializers.req>} serialized
 * @returns {ReturnType<typeof stdSerializers.req>}
 */
const requestSerializer = serialized => {
    serialized.url = redactUrl(serialized.url);

    // A request that never reached Express has no parsed query to censor.
    if (serialized.query) {
        serialized.query = redactQuery(serialized.query);
    }

    return serialized;
};

/** @type {import('pino-http').Options<import('express').Request, import('express').Response>} */
const options = {
    customErrorObject: (_req, _res, _err, loggableObject) => {
        const { traceId } = context.getStore()?.get('logger')?.bindings() || {};

        return {
            traceId,
            ...loggableObject,
        };
    },
    customReceivedObject: (req, res, loggableObject) => {
        const { displayName, membershipType } =
            /** @type {import('../users/user.routes.js').AppSessionData} */ (
                /** @type {unknown} */ (req.session)
            ) ?? {};
        const { From: phoneNumber } = req.body ?? {};
        const { traceId } = context.getStore()?.get('logger')?.bindings() || {};

        res.setHeader('X-Trace-Id', traceId ?? '');

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
        req: requestSerializer,
        res: stdSerializers.res,
    },
    useLevel: 'info',
};

/**
 * `PinoHttp` is a factory function, not a class - this was previously
 * wrapped in `class HttpLog extends PinoHttp { constructor() { super(...) } }`
 * and instantiated via `new HttpLog()`. That "worked" only because
 * `PinoHttp()` returns an object (the logger middleware function), and a
 * derived class's `super()` call substitutes that returned object for
 * `this` - an obscure JS quirk TypeScript's type system doesn't model
 * (`extends` requires an actual constructor type). Calling the factory
 * directly is equivalent and far more legible.
 */
export default PinoHttp(options);
export { requestSerializer };
