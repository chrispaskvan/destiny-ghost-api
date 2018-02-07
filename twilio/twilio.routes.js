/**
 * Twilio inbound and outbound request URLs. See the article
 * at {@link https://twilio.radicalskills.com/projects/getting-started-with-twiml/1.html}
 * for instructions on how to debug these routes locally. Remember
 * to update the DOMAIN environment variable.
 */
const AuthenticationMiddleWare = require('../authentication/authentication.middleware'),
    TwilioController = require('./twilio.controller'),
    express = require('express');

const routes = function ({ authenticationController, destinyService, userService, worldRepository }) {
	const middleware = new AuthenticationMiddleWare({ authenticationController });
    const twilioRouter = express.Router();
    const twilioController = new TwilioController({ destinyService, userService, worldRepository });

    twilioRouter.route('/destiny/r')
		.post(function (req, res, next) {
			middleware.authenticateUser(req, res, next);
		}, function (req, res) {
			twilioController.request(req, res);
        });
    twilioRouter.route('/destiny/s')
        .post(function (req, res) {
            twilioController.statusCallback(req, res);
        });
    twilioRouter.route('/destiny/f')
        .post(function (req, res) {
            twilioController.fallback(req, res);
        });

    return twilioRouter;
};

module.exports = routes;
