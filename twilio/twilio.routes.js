/**
 * Twilio inbound and outbound request URLs. See the article
 * at {@link https://twilio.radicalskills.com/projects/getting-started-with-twiml/1.html}
 * for instructions on how to debug these routes locally. Remember
 * to update the DOMAIN environment variable.
 */
import { Router } from 'express';
import { StatusCodes } from 'http-status-codes';
import twilio from 'twilio';

import AuthenticationMiddleWare from '../authentication/authentication.middleware';
import TwilioController from './twilio.controller';

import configuration from '../helpers/config';

const { twiml: { MessagingResponse }, validateRequest } = twilio;

const { twilio: { attributes, authToken } } = configuration;

const routes = ({
    authenticationController,
    authenticationService,
    destinyService,
    userService,
    worldRepository,
}) => {
    const middleware = new AuthenticationMiddleWare({ authenticationController });
    const twilioRouter = Router();
    const twilioController = new TwilioController({
        authenticationService, destinyService, userService, worldRepository,
    });

    twilioRouter.route('/destiny/r')
        .post(async (req, res, next) => await middleware.authenticateUser(req, res, next),
            async (req, res) => {
                const header = req.headers['x-twilio-signature'];
                const {
                    body,
                    cookies: requestCookies = {},
                    originalUrl,
                } = req;

                if (!validateRequest(authToken, header, `${process.env.PROTOCOL}://${process.env.DOMAIN}${originalUrl}`, body)) {
                    res.writeHead(StatusCodes.FORBIDDEN);

                    return res.end();
                }

                const { cookies = {}, media, message } = await twilioController.request({
                    body,
                    cookies: requestCookies,
                });

                if (!message) {
                    res.writeHead(StatusCodes.FORBIDDEN);

                    return res.end();
                }

                for (const [key, value] of Object.entries(cookies)) {
                    if (value) {
                        res.cookie(key, value);
                    } else {
                        res.clearCookie(key);
                    }
                }

                const twiml = new MessagingResponse();

                if (media) {
                    twiml.message(attributes, message).media(media);
                } else {
                    twiml.message(attributes, message);
                }
                res.writeHead(StatusCodes.OK, {
                    'Content-Type': 'text/xml',
                });

                return res.end(twiml.toString());
            });

    twilioRouter.route('/destiny/s')
        .post(async (req, res) => {
            const header = req.headers['x-twilio-signature'];
            const {
                body,
                query = {},
                originalUrl,
            } = req;
            const claimCheck = query['claim-check-number'];
            const notificationType = query['notification-type'];

            if (!validateRequest(authToken, header, `${process.env.PROTOCOL}://${process.env.DOMAIN}${originalUrl}`, body)) {
                res.writeHead(StatusCodes.FORBIDDEN);

                return res.end();
            }

            await twilioController.statusCallback({
                ...body,
                ...(claimCheck && { ClaimCheck: claimCheck }),
                ...(notificationType && { NotificationType: notificationType }),
            });

            const twiml = new MessagingResponse();

            res.writeHead(StatusCodes.OK, {
                'Content-Type': 'text/xml',
            });
            res.end(twiml.toString());
        });

    twilioRouter.route('/destiny/f')
        .post((req, res) => {
            const message = TwilioController.fallback();
            const twiml = new MessagingResponse();

            twiml.message(attributes, message);
            res.writeHead(StatusCodes.OK, {
                'Content-Type': 'text/xml',
            });
            res.end(twiml.toString());
        });

    return twilioRouter;
};

export default routes;
