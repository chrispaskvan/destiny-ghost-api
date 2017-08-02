/**
 * Created by chris on 8/23/15.
 */
'use strict';
/**
 * @todo clean up
 */
var ApplicationInsights = require('applicationinsights'),
    DestinyCache = require('./destiny/destiny.cache'),
    DestinyService = require('./destiny/destiny.service'),
    Log = require('./models/log'),
    UserAuthentication = require('./users/user.authentication'),
    UserCache = require('./users/user.cache'),
    UserService = require('./users/user.service'),
    bodyParser = require('body-parser'),
    cookieParser = require('cookie-parser'),
    documents = require('./helpers/documents'),
    express = require('express'),
    fs = require('fs'),
    http = require('http'),
    path = require('path'),
    session = require('express-session'),
    redis = require('redis'),
    world = require('./helpers/world');

var RedisStore = require('connect-redis')(session);

var app = express();
var port = process.env.PORT || 1100;

var appInsightsConfig = JSON.parse(fs.readFileSync(process.env.APPINSIGHTS || './settings/applicationInsights.json'));
var appInsights = new ApplicationInsights.setup(appInsightsConfig.instrumentationKey).start();
appInsights.client.commonProperties = {
    environment: 'M2'
};
appInsights.client.trackEvent('Server restarted.');

app.use(bodyParser.json());
app.use(bodyParser.urlencoded({
    extended: true
}));
app.use(cookieParser());
// jscs:ignore requireCapitalizedComments
// noinspection JSLint
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
var redisConfig = JSON.parse(fs.readFileSync('./settings/redis.json'));
var client = redis.createClient(redisConfig.port, redisConfig.host, {
    auth_pass: redisConfig.key // jscs:ignore requireCamelCaseOrUpperCaseIdentifiers
});
var key = 'Dredgen Yorn';
var value = 'Thorn';
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
var sessionConfig = JSON.parse(fs.readFileSync('./settings/session.json'));
// jscs:ignore requireCapitalizedComments
// noinspection SpellCheckingInspection
var ghostSession = session({
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
var logger = new Log();
app.use(logger.requestLogger());
app.use(logger.errorLogger());
/**
 * Dependencies
 */
var destinyCache = new DestinyCache();
var destinyService = new DestinyService(destinyCache);
var userCache = new UserCache();
var userService = new UserService(userCache, documents);
var authenticate = new UserAuthentication(userCache, destinyService, userService).authenticate();
/**
 * Routes
 */
var destinyRouter = require('./destiny/destiny.routes')(authenticate, destinyService, userService, world);
app.use('/api/destiny', destinyRouter);
/**
 * ToDo: Health Check
 * redis
 * documentdb
 * destiny api
 * twilio client?
 * azure?
 */
//var notificationRouter = require('./routes/notificationRoutes')();
//app.use('/api/notifications', notificationRouter);

var twilioRouter = require('./routes/twilioRoutes')(authenticate, destinyService, userService);
app.use('/api/twilio', twilioRouter);

var userRouter = require('./users/user.routes')(authenticate, destinyService, userService);
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

// jscs:ignore requireCapitalizedComments
// noinspection JSLint
app.use(function (err, req, res, next) {
    appInsights.client.trackRequest(req, res);
    next();
});
/**
 * Server
 */
var start = new Date();
app.listen(port, function init() {
    console.log('Gulp is running on port ' + port + '.');
    var end = new Date();
    var duration = end - start;
    appInsights.client.trackMetric('StartupTime', duration);
});

module.exports = app;
