/**
 * Application Server
 */
require('dotenv').config();

const Routes = require('./routes'),
	{ instrumentationKey } = require('./settings/applicationInsights.json'),
	{ name } = require('./package.json'),
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
const start = new Date();

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
    extended: true
}));
app.use(cookieParser());

/**
 * Disable X-Powered-By Header
 */
app.disable('x-powered-by');

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
 * Routes
 */
const routes = new Routes(client);
app.use('/', routes);

/**
 * Request/Response and Error Middleware Loggers
 */
app.use(log.requestLogger());
app.use(log.errorLogger());

/**
 * Check for the latest manifest definition and database from Bungie.
 */
routes.validateManifest();

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

app.use((err, req, res, next) => {
	res.status(500).json(err);
});

/**
 * Server
 */
const server = http.createServer(app);
terminus(server, {
	signal: 'SIGINT',
	onSignal: () => {
		return new Promise((resolve) => {
			client.quit();
			resolve();
		});
	}
});

server.listen(port, function init() {
	// eslint-disable-next-line no-console
    console.log('Running on port ' + port + '.');

	//let client = applicationInsights.defaultClient;
	const end = new Date();
	const duration = end - start;

	// client.trackMetric({
	// 	name: 'Startup Time',
	// 	value: duration
	// });
});

module.exports = app;
