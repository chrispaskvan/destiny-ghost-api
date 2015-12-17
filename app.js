/**
 * Created by chris on 8/23/15.
 */
'use strict';
var ApplicationInsights = require('applicationinsights'),
    bodyParser = require('body-parser'),
    cookieParser = require('cookie-parser'),
    express = require('express'),
    fs = require('fs'),
    Log = require('./models/log');

var app = express();
var port = process.env.PORT || 1100;

var logger = new Log();
app.use(logger.requestLogger());

var appInsightsConfig = JSON.parse(fs.readFileSync(process.env.APPINSIGHTS || './settings/applicationInsights.json'));
var appInsights = new ApplicationInsights.setup(appInsightsConfig.instrumentationKey)
    .start();
appInsights.client.commonProperties = {
    environment: 'M2'
};
appInsights.client.trackEvent('Server restarted.');

app.use(bodyParser.json());
var destinyRouter = require('./routes/destinyRoutes')();
app.use('/api/destiny', destinyRouter);

app.use(logger.errorLogger());

app.use(bodyParser.urlencoded({
    extended: true
}));
app.use(cookieParser());
var twilioRouter = require('./routes/twilioRoutes')();
app.use('/api/twilio', twilioRouter);

app.use(function (err, req, res, next) {
    appInsights.client.trackRequest(req, res);
    next();
});

var start = new Date();
app.listen(port, function () {
    console.log('Gulp is running on port ' + port + '.');
    var end = new Date();
    var duration = end - start;
    appInsights.client.trackMetric('StartupTime', duration);
});

module.exports = app;
