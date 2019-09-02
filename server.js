/**
 * Application Server
 */
require('dotenv').config();

const express = require('express');
const fs = require('fs');
const http = require('http');
const https = require('https');
const path = require('path');
const session = require('express-session');

const DestinyError = require('./destiny/destiny.error');
const RequestError = require('./helpers/request.error');
const Routes = require('./routes');
const { instrumentationKey } = require('./settings/applicationInsights.json');
const { name } = require('./package.json');
const applicationInsights = require('applicationinsights');
const bodyParser = require('body-parser');
const { store } = require('./helpers/session-store');
const log = require('./helpers/log');
const sessionConfig = require(`./settings/session.json`);

const app = express();
const port = process.env.PORT;

/**
 * Application Insights
 */
// applicationInsights.setup(instrumentationKey).start();
// const key = applicationInsights.defaultClient.context.keys.cloudRole;
// applicationInsights.defaultClient.context.tags[key] = name;

// jscs:ignore requireCapitalizedComments
// noinspection JSLint
// app.use((err, req, res, next) => {
// 	applicationInsights.defaultClient.trackRequest(req, res);
// 	next(err);
// });

app.use(bodyParser.json());
app.use(bodyParser.urlencoded({
    extended: true,
}));

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
        domain: sessionConfig.cookie.domain,
        httpOnly: true,
        maxAge: sessionConfig.cookie.maxAge,
        secure: sessionConfig.cookie.secure,
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
 * Check that the database directories exist.
 */
const databases = [process.env.DESTINY_DATABASE_DIR, process.env.DESTINY2_DATABASE_DIR];

databases.forEach(database => {
    const directories = database.split('/');

    directories.forEach((directory, index) => {
        const path = directories.slice(0, index + 1).join('/');

        if (!fs.existsSync(path)) {
            fs.mkdirSync(path);
        }
    });
});

/**
 * Request/Response and Error Middleware Loggers
 */
app.use(log.requestLogger());
app.use(log.errorLogger());

/**
 * Routes
 */
const routes = new Routes();
app.use('/', routes);

/**
 * Check for the latest manifest definition and database from Bungie.
 */
routes.validateManifest();

// jscs:ignore requireCapitalizedComments
// noinspection JSLint
app.get('/', (req, res) => {
    if (!req.secure) {
        res.redirect(301, `https://api2.destiny-ghost.com${req.url}`);

        return;
    }

    res.sendFile(path.join(`${__dirname}/signIn.html`));
});

// jscs:ignore requireCapitalizedComments
// noinspection JSLint
app.get('/ping', (req, res) => {
    res.json({
        pong: Date.now(),
    });
});

app.use((err, req, res, next) => {
    const {
        code, message, status, statusText,
    } = err;

    if (res.status) {
        if (err instanceof DestinyError) {
            res.status(500).json({
                errors: [{
                    code,
                    message,
                    status,
                }],
            });
        } else if (err instanceof RequestError) {
            res.status(500).json({
                errors: [{
                    status,
                    statusText,
                }],
            });
        } else {
            res.status(500).json({
                errors: [{
                    message,
                }],
            });
        }
    } else {
        next(err);
    }
});

/**
 * Server(s)
 */
if (process.env.NODE_ENV === 'development') {
    const httpsOptions = {
        key: fs.readFileSync('./security/_wildcard.destiny-ghost.com-key.pem'),
        cert: fs.readFileSync('./security/_wildcard.destiny-ghost.com.pem'),
    };
    const server = https.createServer(httpsOptions, app);
    server.listen(443,
        () => console.log('HTTPS server listening on port 443.'));
}

const insecureServer = http.createServer(app);
insecureServer.listen(port,
    () => console.log(`HTTP server listening on port ${port}`));

module.exports = app;
