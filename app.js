/**
 * Created by chris on 8/23/15.
 */
var bodyParser = require('body-parser');
var express = require('express');

var app = express();
var port = process.env.PORT || 1100;

app.use(bodyParser.json());
app.use(function(err, req, res, next) {
    //log.error(err);
    next();
});
var destinyRouter = require('./routes/destinyRoutes')();
app.use('/api/destiny', destinyRouter);
var twilioRouter = require('./routes/twilioRoutes')();
app.use('/api/twilio', twilioRouter);
app.use(function modify(req, res, next){
    //log.info(res.body);

    next();
});
app.listen(port, function() {
    console.log('Gulp is running on port ' + port + '.');
});

module.exports = app;
