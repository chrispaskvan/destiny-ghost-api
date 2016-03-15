/**
 * Created by chris on 8/23/15.
 */
'use strict';
var ApplicationInsights = require('applicationinsights'),
    bodyParser = require('body-parser'),
    cookieParser = require('cookie-parser'),
    express = require('express'),
    fs = require('fs'),
    Log = require('./models/log'),
    path = require('path');

var app = express();
var port = process.env.PORT || 1100;
var virtualPath = process.env.VIRTUALPATH || '';
app.get(virtualPath + '/', function (req, res) {
    res.render('index', { virtualPath: virtualPath });
});

var appInsightsConfig = JSON.parse(fs.readFileSync(process.env.APPINSIGHTS || './settings/applicationInsights.json'));
var appInsights = new ApplicationInsights.setup(appInsightsConfig.instrumentationKey)
    .start();
appInsights.client.commonProperties = {
    environment: 'M2'
};
appInsights.client.trackEvent('Server restarted.');

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
 * Virtual Directory Path
 */
app.use(process.env.VIRTUALPATH || '', app._router);
/**
 * Logs
 * @type {Log|exports|module.exports}
 */
var logger = new Log();
app.use(logger.requestLogger());
/**
 * Routes
 */
var destinyRouter = require('./routes/destinyRoutes')();
app.use('/api/destiny', destinyRouter);

var notificationRouter = require('./routes/notificationRoutes')();
app.use('/api/notifications', notificationRouter);

var twilioRouter = require('./routes/twilioRoutes')();
app.use('/api/twilio', twilioRouter);

var userRouter = require('./routes/userRoutes')();
app.use('/api/users', userRouter);

app.use(function (err, req, res, next) {
    appInsights.client.trackRequest(req, res);
    next();
});

app.get('/signIn', function (req, res) {
    res.sendFile(path.join(__dirname + '/signIn.html'));
});

var start = new Date();
app.listen(port, function () {
    console.log('Gulp is running on port ' + port + '.');
    var end = new Date();
    var duration = end - start;
    appInsights.client.trackMetric('StartupTime', duration);
});

module.exports = app;
