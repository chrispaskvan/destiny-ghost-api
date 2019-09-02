/**
 * Twilio inbound and outbound request URLs. See the article
 * at {@link https://twilio.radicalskills.com/projects/getting-started-with-twiml/1.html}
 * for instructions on how to debug these routes locally. Remember
 * to update the DOMAIN environment variable.
 */
const express = require('express');
const AuthenticationMiddleWare = require('../authentication/authentication.middleware');
const TwilioController = require('./twilio.controller');

const routes = ({
    authenticationController,
    authenticationService,
    destinyService,
    destinyTrackerService,
    userService,
    worldRepository,
}) => {
    const middleware = new AuthenticationMiddleWare({ authenticationController });
    const twilioRouter = express.Router();
    const twilioController = new TwilioController({
        authenticationService, destinyService, destinyTrackerService, userService, worldRepository,
    });

    twilioRouter.route('/destiny/r')
        .post((req, res, next) => middleware.authenticateUser(req, res, next),
            (req, res, next) => twilioController.request(req, res)
                .catch(next));

    twilioRouter.route('/destiny/s')
        .post((req, res, next) => twilioController.statusCallback(req, res)
            .catch(next));

    twilioRouter.route('/destiny/f')
        .post((req, res, next) => TwilioController.fallback(req, res)
            .catch(next));

    return twilioRouter;
};

module.exports = routes;
