/**
 * Created by chris on 9/28/15.
 */
var express = require('express'),
    twilio = require('twilio');

var routes = function () {
    var twilioRouter = express.Router();

    twilioRouter.route('/test')
        .get(function(req, res) {
            res.json("OK");
        });

    twilioRouter.route('/test2')
        .post(function(req, res) {
            console.log('------------');
            console.log(req.body);
            var resp = new twilio.TwimlResponse();
            if (req.body.Body) {
                console.log(req.body.Body.trim().toLowerCase());
            }
            resp.message('Thanks for subscribing!');
            res.writeHead(200, {
                'Content-Type':'text/xml'
            });
            res.end(resp.toString());
        });

    return twilioRouter;
};

module.exports = routes;
