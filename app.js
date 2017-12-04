/**
 * Application Server
 */
const Log = require('./models/log'),
	Routes = require('./routes'),
	appInsightsConfig = require('./settings/applicationInsights.json'),
	applicationInsights = require('applicationinsights'),
    bodyParser = require('body-parser'),
    cookieParser = require('cookie-parser'),
    express = require('express'),
	fs = require('fs'),
    path = require('path'),
    session = require('express-session'),
    redis = require('redis'),
	redisConfig = require('./settings/redis.json'),
    sessionConfig = require('./settings/session.json');

const RedisStore = require('connect-redis')(session);
const app = express();
const port = process.env.PORT || 1100;

/**
 * Application Insights
 */
applicationInsights.setup(appInsightsConfig.instrumentationKey).start();
applicationInsights.defaultClient.commonProperties = {
    environment: 'M2'
};
applicationInsights.defaultClient.trackEvent('Server restarted.');

app.use(bodyParser.json());
app.use(bodyParser.urlencoded({
    extended: true
}));
app.use(cookieParser());

/**
 * Set Access Headers
 */
app.use(function (req, res, next) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS, PUT, PATCH, DELETE');
    res.setHeader('Access-Control-Allow-Credentials', true);
    next();
});

/**
 * Redis Client
 */
const client = redis.createClient(redisConfig.port, redisConfig.host, {
    auth_pass: redisConfig.key // jscs:ignore requireCamelCaseOrUpperCaseIdentifiers
});

/**
 * Attach Session
 */
const ghostSession = session({
    cookie: {
        secure: false
    },
    name: sessionConfig.cookie.name,
    resave: false,
    saveUninitialized: true,
    secret: sessionConfig.secret,
    store: new RedisStore({
        client: client
    })
});
app.use(ghostSession);

/**
 * Logs
 */
const logger = new Log();
app.use(logger.requestLogger());
app.use(logger.errorLogger());

/**
 * Routes
 */
const routes = new Routes(client);
app.use('/', routes);

// jscs:ignore requireCapitalizedComments
// noinspection JSLint
app.get('/', function (req, res) {
    res.sendFile(path.join(__dirname + '/signIn.html'));
});

// jscs:ignore requireCapitalizedComments
// noinspection JSLint
app.get('/ping', function (req, res) {
    res.json({
        pong: Date.now()
    });
});

// jscs:ignore requireCapitalizedComments
// noinspection JSLint
app.use(function (err, req, res, next) {
	applicationInsights.defaultClient.trackRequest(req, res);
    next(err);
});

/**
 * Check for the latest manifest definition and database from Bungie.
 */
const databases = process.env.DATABASE;
if (!fs.existsSync(databases)) {
	fs.mkdirSync(databases);
}
routes.validateManifest();

/**
 * Server
 */
const start = new Date();
app.listen(port, function init() {
	// eslint-disable-next-line no-console
    console.log('Gulp is running on port ' + port + '.');

	const end = new Date();
	const duration = end - start;
	applicationInsights.defaultClient.trackMetric('StartupTime', duration);
});

module.exports = app;
