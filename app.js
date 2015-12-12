/**
 * Created by chris on 8/23/15.
 */
'use strict';
var bodyParser = require('body-parser'),
    cookieParser = require('cookie-parser'),
    express = require('express');

var app = express();
var port = process.env.PORT || 1100;

app.use(bodyParser.json());
app.use(function (err, req, res, next) {
    next();
});
var destinyRouter = require('./routes/destinyRoutes')();
app.use('/api/destiny', destinyRouter);

function errorHandler (err, req, res, next) {
    res.status(500);
    res.render('error', { error: err });
}
app.use(errorHandler);

app.use(bodyParser.urlencoded({
    extended: true
}));
app.use(cookieParser());
var twilioRouter = require('./routes/twilioRoutes')();
app.use('/api/twilio', twilioRouter);
app.use(function modify(req, res, next) {
    next();
});
app.listen(port, function () {
    console.log('Gulp is running on port ' + port + '.');
});

module.exports = app;
