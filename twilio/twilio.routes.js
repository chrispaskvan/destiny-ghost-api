/**
 * Twilio inbound and outbound request URLs. See the article
 * at {@link https://twilio.radicalskills.com/projects/getting-started-with-twiml/1.html}
 * for instructions on how to debug these routes locally. Remember
 * to update the DOMAIN environment variable.
 */
const AuthenticationMiddleWare = require('../authentication/authentication.middleware'),
    TwilioController = require('./twilio.controller'),
    express = require('express');

const routes = ({ authenticationController, authenticationService, destinyService, userService }) => {
	const middleware = new AuthenticationMiddleWare({ authenticationController });
    const twilioRouter = express.Router();
    const twilioController = new TwilioController({ authenticationService, destinyService, userService });

    twilioRouter.route('/destiny/r')
		.post((req, res, next) => middleware.authenticateUser(req, res, next),
			(req, res) => twilioController.request(req, res));

    twilioRouter.route('/destiny/s')
        .post((req, res) => twilioController.statusCallback(req, res));

    twilioRouter.route('/destiny/f')
        .post((req, res) => twilioController.fallback(req, res));

    return twilioRouter;
};

module.exports = routes;
