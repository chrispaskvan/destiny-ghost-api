/**
 * Created by chris on 8/23/15.
 */
const applicationInsights = require('applicationinsights'),
	AuthenticationService = require('./authentication/authentication.service'),
	AuthenticationController = require('./authentication/authentication.controller'),
    Destiny2Cache = require('./destiny2/destiny2.cache'),
    Destiny2Service = require('./destiny2/destiny2.service'),
    DestinyCache = require('./destiny/destiny.cache'),
    DestinyService = require('./destiny/destiny.service'),
	Log = require('./models/log'),
    UserCache = require('./users/user.cache'),
    UserService = require('./users/user.service'),
	appInsightsConfig = require('./settings/applicationInsights.json'),
    bodyParser = require('body-parser'),
    cookieParser = require('cookie-parser'),
    documents = require('./helpers/documents'),
    express = require('express'),
    graphql = require('express-graphql'),
    path = require('path'),
    session = require('express-session'),
    redis = require('redis'),
	redisConfig = require('./settings/redis.json'),
    sessionConfig = require('./settings/session.json'),
    World2 = require('./helpers/world2');

const RedisStore = require('connect-redis')(session);
const app = express();
const port = process.env.PORT || 1100;

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
 * Session
 */
const client = redis.createClient(redisConfig.port, redisConfig.host, {
    auth_pass: redisConfig.key // jscs:ignore requireCamelCaseOrUpperCaseIdentifiers
});

/**
 * Test Redis
 */
const key = 'Dredgen Yorn';
const value = 'Thorn';
client.set(key, value, function (err, res) {
    if (err) {
        console.log('Redis client #set error ' + err);
    } else {
        console.log('Redis client #set returned ' + res);
    }
});
client.get(key, function (err, res) {
    if (err) {
        console.log('Redis client #set error ' + err);
    } else {
        console.log('Redis client #get ' + (res === value ? 'succeeded' : 'failed'));
    }
});
client.del(key, function (err, res) {
    if (err) {
        console.log('Redis client #del error ' + err);
    } else {
        console.log('Redis client #del ' + (res === 1 ? 'succeeded' : 'failed'));
    }
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
 * @type {Log|exports|module.exports}
 */
const logger = new Log();
app.use(logger.requestLogger());
app.use(logger.errorLogger());

/**
 * Dependencies
 */
const destinyCache = new DestinyCache();
const destinyService = new DestinyService({
    cacheService: destinyCache
});

const userCache = new UserCache();
const userService = new UserService({
    cacheService: userCache,
    documentService: documents
});

const authenticationService = new AuthenticationService({
    cacheService: userCache,
    destinyService,
    userService
});
const authenticationController = new AuthenticationController(authenticationService);

/**
 * Routes
 */
const world2 = new World2();
const destinyRouter = require('./destiny/destiny.routes')(authenticationController, destinyService, userService, world2);
app.use('/api/destiny', destinyRouter);


const destiny2Cache = new Destiny2Cache();
const destiny2Service = new Destiny2Service({ cacheService: destiny2Cache });
const destiny2Router = require('./destiny2/destiny2.routes')(authenticationController, destiny2Service, userService, world2);
app.use('/api/destiny2', destiny2Router);

/**
 * ToDo: Health Check
 * redis
 * documentdb
 * destiny api
 * twilio client?
 * azure?
 */
const twilioRouter = require('./twilio/twilio.routes')(authenticationController, destiny2Service, userService, world2);
app.use('/api/twilio', twilioRouter);

const userRouter = require('./users/user.routes')(authenticationController, destinyService, userService);
app.use('/api/users', userRouter);

// jscs:ignore requireCapitalizedComments
// noinspection JSLint
app.get('/', function (req, res) {
    res.sendFile(path.join(__dirname + '/signIn.html'));
});
app.get('/coverage', function (req, res) {
    res.sendFile(path.join(__dirname + '/.coverage/lcov-report/index.html'));
});

// jscs:ignore requireCapitalizedComments
// noinspection JSLint
app.get('/ping', function (req, res) {
    res.json({
        pong: Date.now()
    });
});

const ncSchema = require('./schema');
app.use('/graphql', graphql({
    schema: ncSchema,
    graphiql: true
}));

// jscs:ignore requireCapitalizedComments
// noinspection JSLint
app.use(function (err, req, res, next) {
	applicationInsights.defaultClient.trackRequest(req, res);
    next(err);
});

const Subscriber = require('./helpers/subscriber');
const subscriber = new Subscriber();
const Publisher = require('./helpers/publisher');
const p = new Publisher();
/**
 * Server
 */
const start = new Date();
app.listen(port, function init() {
    console.log('Gulp is running on port ' + port + '.');
	const end = new Date();
	const duration = end - start;
	applicationInsights.defaultClient.trackMetric('StartupTime', duration);
});

module.exports = app;
