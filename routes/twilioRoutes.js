/**
 * Created by chris on 9/28/15.
 */
'use strict';
var express = require('express'),
    TwilioController = require('../controllers/twilioController');

var routes = function () {
    var twilioRouter = express.Router();
    var twilioController = new TwilioController();
    twilioRouter.route('/destiny/r')
        .post(twilioController.request);
    twilioRouter.route('/destiny/s')
        .post(twilioController.statusCallback);
    twilioRouter.route('/destiny/f')
        .post(twilioController.fallback);
    return twilioRouter;
};

module.exports = routes;
