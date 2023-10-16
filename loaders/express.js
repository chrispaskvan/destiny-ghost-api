import bodyParser from 'body-parser';
import compression from 'compression';
import cookieParser from 'cookie-parser';
import session from 'express-session';
import helmet from 'helmet';

import configuration from '../helpers/config';
import httpLog from '../helpers/httpLog';
import { contextMiddleware } from '../helpers/log';
import rateLimiterMiddleware from '../helpers/rate-limiter.middleware';
import store from '../helpers/store';

export default app => {
    app.use(bodyParser.json({
        limit: '1mb',
    }));
    app.use(bodyParser.urlencoded({
        limit: '1mb',
        extended: true,
        parameterLimit: 11,
    }));
    app.use(compression());
    app.use(cookieParser());
    app.use(helmet.crossOriginResourcePolicy({
        policy: 'cross-origin',
    }));

    /**
     * Disable etag and x-powered-by headers.
     */
    app.disable('etag').disable('x-powered-by');

    /**
     * Set Access Headers
     */
    app.use((req, res, next) => {
        res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS, PUT, PATCH, DELETE');
        res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
        res.setHeader('Access-Control-Allow-Credentials', true);
        next();
    });

    /**
     * Attach Session
     */
    const ghostSession = session({
        cookie: {
            domain: process.env.DOMAIN,
            httpOnly: true,
            maxAge: configuration.session.cookie.maxAge,
            secure: true,
        },
        name: configuration.session.cookie.name,
        resave: false,
        saveUninitialized: true,
        secret: configuration.session.secret,
        store,
    });

    app.use((req, res, next) => {
        let numberOfRetries = 3;

        function lookupSession(err) {
            if (err) {
                return next(err);
            }

            numberOfRetries -= 1;

            if (req.session !== undefined) {
                return next();
            }

            if (numberOfRetries < 0) {
                return next(new Error('Failed to look up session.'));
            }

            return ghostSession(req, res, lookupSession);
        }

        lookupSession();
    });

    /**
     * Attach Context
     */
    app.use(contextMiddleware);

    /**
     * Request/Response and Error Loggers
     */
    app.use(httpLog);

    /**
     * Rate Limiter
     */
    app.use(rateLimiterMiddleware);
};
