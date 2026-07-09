import compression from 'compression';
import cookieParser from 'cookie-parser';
import express from 'express';
import session from 'express-session';
import helmet from 'helmet';
import { StatusCodes } from 'http-status-codes';

import configuration from '../helpers/config.js';
import httpLog from '../helpers/httpLog.js';
import { contextMiddleware } from '../helpers/log.js';
import rateLimiterMiddleware from '../helpers/rate-limiter.middleware.js';
import store from '../helpers/store.js';

export default app => {
    app.use(
        express.json({
            limit: '1mb',
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
    app.use(cookieParser());
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
     * Set Access Headers
     */
    app.use((_req, res, next) => {
        res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS, PUT, PATCH, DELETE');
        res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
        res.setHeader('Access-Control-Allow-Credentials', true);
        next();
    });

    /**
     * Attach Context
     *
     * Runs before the session middleware so that errors raised there, e.g.
     * when the session store is unavailable, are logged with a traceId.
     */
    app.use(contextMiddleware);

    /**
     * Attach Session
     */
    if (process.env.NODE_ENV === 'production') {
        app.set('trust proxy', 1);
    }

    const domain = `.${process.env.DOMAIN.split('.').slice(-2).join('.')}`;
    const ghostSession = session({
        cookie: {
            domain,
            httpOnly: true,
            maxAge: configuration.session.cookie.maxAge,
            secure: true,
        },
        name: configuration.session.cookie.name,
        resave: false,
        saveUninitialized: false,
        secret: configuration.session.secret,
        store,
    });

    app.use(ghostSession);

    /**
     * Request/Response and Error Loggers
     *
     * Runs before the session guard so requests still get correlation
     * headers and structured logs during a session store outage.
     */
    app.use(httpLog);

    /**
     * If the Redis store is disconnected, express-session calls next() without
     * setting req.session. Fail fast with an explicit error rather than letting
     * the request proceed sessionless. Liveness and health endpoints are exempt
     * so they can still report diagnostics during a session store outage.
     */
    app.use((req, _res, next) => {
        const isSessionless = /^\/(?:ping|health)(?:\/|$)/.test(req.path);

        if (!isSessionless && !req.session) {
            const error = new Error('Session store unavailable.');

            error.statusCode = StatusCodes.SERVICE_UNAVAILABLE;

            return next(error);
        }

        return next();
    });

    /**
     * Rate Limiter
     */
    app.use(rateLimiterMiddleware);

    /**
     * Request/Response Timeouts
     */
    app.use((req, res, next) => {
        req.setTimeout(5000); // Set request timeout to 5 seconds
        res.setTimeout(5000); // Set response timeout to 5 seconds
        next();
    });
};
