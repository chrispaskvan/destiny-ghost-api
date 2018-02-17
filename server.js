/**
 * Application Server
 */
require('dotenv').config();

const Routes = require('./routes'),
	appInsightsConfig = require('./settings/applicationInsights.json'),
	applicationInsights = require('applicationinsights'),
    bodyParser = require('body-parser'),
    cookieParser = require('cookie-parser'),
    express = require('express'),
	fs = require('fs'),
	http = require('http'),
	log = require('./helpers/log'),
	path = require('path'),
    session = require('express-session'),
    redis = require('redis'),
	redisConfig = require('./settings/redis.json'),
	sessionConfig = require('./settings/session.' + process.env.NODE_ENV + '.json'),
	terminus = require('@godaddy/terminus');

const RedisStore = require('connect-redis')(session);
const app = express();
const port = process.env.PORT;

/**
 * Application Insights
 */
applicationInsights.setup(appInsightsConfig.instrumentationKey).start();

// jscs:ignore requireCapitalizedComments
// noinspection JSLint
app.use(function (err, req, res, next) {
	applicationInsights.defaultClient.trackRequest(req, res);
	next(err);
});

app.use(bodyParser.json());
app.use(bodyParser.urlencoded({
    extended: true
}));
app.use(cookieParser());

/**
 * Set Access Headers
 */
app.use(function (req, res, next) {
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS, PUT, PATCH, DELETE');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
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
		domain: sessionConfig.cookie.domain,
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
 * Request/Response and Error Middleware Loggers
 */
app.use(log.requestLogger());
app.use(log.errorLogger());

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
const server = http.createServer(app);
terminus(server, {
	signal: 'SIGINT',
	onSignal: function () {
		return new Promise((resolve) => {
			client.quit();
			resolve();
		});
	}
});

const start = new Date();
server.listen(port, function init() {
	// eslint-disable-next-line no-console
    console.log('Running on port ' + port + '.');

	const end = new Date();
	const duration = end - start;
	applicationInsights.defaultClient.trackMetric('StartupTime', duration);
});

module.exports = app;
