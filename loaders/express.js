const bodyParser = require('body-parser');
const cookieParser = require('cookie-parser');
const session = require('express-session');

const httpLog = require('../helpers/httpLog');
const rateLimiterMiddleware = require('../helpers/rate-limiter.middleware');
const store = require('../helpers/store');
const { session: sessionConfig } = require('../helpers/config');

module.exports = app => {
    app.use(bodyParser.json());
    app.use(bodyParser.urlencoded({
        extended: true,
    }));
    app.use(cookieParser());

    /**
     * Disable X-Powered-By Header
     */
    app.disable('x-powered-by');

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
            maxAge: sessionConfig.cookie.maxAge,
            secure: false,
        },
        name: sessionConfig.cookie.name,
        resave: false,
        saveUninitialized: true,
        secret: sessionConfig.secret,
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
     * Request/Response and Error Loggers
     */
    app.use(httpLog);

    /**
     * Rate Limiter
     */
    app.use(rateLimiterMiddleware);
};
