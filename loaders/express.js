import compression from 'compression';
import cors from 'cors';
import express from 'express';
import session from 'express-session';
import helmet from 'helmet';
import { StatusCodes } from 'http-status-codes';

import configuration from '../helpers/config.js';
import httpLog from '../helpers/httpLog.js';
import { contextMiddleware } from '../helpers/log.js';
import safeReviver from '../helpers/safe-reviver.js';
import store from '../helpers/store.js';
import { twilioPreflightMiddleware } from '../helpers/rate-limiter.middleware.js';

export default app => {
    if (process.env.NODE_ENV === 'production') {
        app.set('trust proxy', 1);
    }

    app.use(contextMiddleware);
    app.use(httpLog);

    app.use(
        '/twilio',
        (_req, res, next) => {
            res.locals.isTwilioWebhook = true;
            next();
        },
        twilioPreflightMiddleware,
        express.json({ limit: '32kb', reviver: safeReviver }),
        express.urlencoded({ limit: '32kb', extended: true, parameterLimit: 51 }),
    );
    app.use(
        express.json({
            limit: '1mb',
            reviver: safeReviver,
        }),
    );
    app.use(
        express.urlencoded({
            limit: '1mb',
            extended: true,
            parameterLimit: 51,
        }),
    );
    app.use(compression());
    app.use(
        helmet.crossOriginResourcePolicy({
            policy: 'cross-origin',
        }),
    );

    /**
     * Disable etag and x-powered-by headers.
     */
    app.disable('etag').disable('x-powered-by');

    /**
     * Cross-Origin Resource Sharing
     *
     * Always expose ETag so cross-origin clients can use If-Match on PATCH /users.
     */
    const { exposedHeaders, ...corsOptions } = configuration.cors ?? {};

    app.use(
        cors({
            ...corsOptions,
            exposedHeaders: [...new Set([].concat(exposedHeaders ?? [], 'ETag'))],
        }),
    );

    /**
     * Attach Session
     */
    const domain = `.${process.env.DOMAIN.split('.').slice(-2).join('.')}`;
    const ghostSession = session({
        cookie: {
            domain,
            httpOnly: true,
            maxAge: configuration.session.cookie.maxAge,
            sameSite: 'lax',
            secure: true,
        },
        name: configuration.session.cookie.name,
        resave: false,
        saveUninitialized: false,
        secret: configuration.session.secret,
        store,
    });

    /**
     * Requests that never read a session skip loading one, which is a Redis
     * round trip: Twilio webhooks; liveness and health, which can then report
     * diagnostics during a store outage; and the API docs, each of whose
     * static assets otherwise waited on a session it did not use.
     *
     * @param {import('express').Request} req
     * @param {import('express').Response} res
     */
    const isSessionless = (req, res) =>
        res.locals.isTwilioWebhook || /^\/(?:docs|health|ping)(?:\/|$)/i.test(req.path);

    app.use((req, res, next) => {
        if (isSessionless(req, res)) {
            return next();
        }

        return ghostSession(req, res, next);
    });

    /**
     * If the Redis store is disconnected, express-session calls next() without
     * setting req.session. Fail fast with an explicit error rather than letting
     * the request proceed sessionless.
     */
    app.use((req, res, next) => {
        if (!isSessionless(req, res) && !req.session) {
            const error = new Error('Session store unavailable.');

            error.statusCode = StatusCodes.SERVICE_UNAVAILABLE;

            return next(error);
        }

        return next();
    });

    /**
     * Request/Response Timeouts
     */
    app.use((req, res, next) => {
        req.setTimeout(5000); // Set request timeout to 5 seconds
        res.setTimeout(5000); // Set response timeout to 5 seconds
        next();
    });
};
