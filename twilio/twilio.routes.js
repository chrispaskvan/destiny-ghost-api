/**
 * Twilio inbound and outbound request URLs. See the article
 * at {@link https://twilio.radicalskills.com/projects/getting-started-with-twiml/1.html}
 * for instructions on how to debug these routes locally. Remember
 * to update the DOMAIN environment variable.
 */
import { Router } from 'express';
import { StatusCodes } from 'http-status-codes';
import twilio from 'twilio';
import Joi from 'joi';

import AuthenticationMiddleWare from '../authentication/authentication.middleware.js';
import TwilioController from './twilio.controller.js';

import configuration from '../helpers/config.js';

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

    // Define a schema for the expected body parameters
    const bodySchema = Joi.object({
        MessageSid: Joi.string().length(34).required(),
        SmsSid: Joi.string().length(34).required(),
        SmsMessageSid: Joi.string().length(34).required(),
        AccountSid: Joi.string().length(34).required(),
        MessagingServiceSid: Joi.string().length(34).required(),
        From: Joi.string().required(),
        To: Joi.string().required(),
        Body: Joi.string().max(1600).required(),
        NumMedia: Joi.number().integer().min(0).required(),
    });

    twilioRouter.route('/destiny/r')
        .post(async (req, res, next) => await middleware.authenticateUser(req, res, next),
            async (req, res) => {
                const header = req.headers['x-twilio-signature'];
                const {
                    body,
                    cookies: requestCookies = {},
                } = req;
                const { error: err, value: sanitizedBody } = bodySchema.validate(body);

                if (err) {
                    return res.status(StatusCodes.BAD_REQUEST).json({ error: err.details[0].message });
                }

                // Reconstruct the URL using known, trusted components
                const reconstructedUrl = `${process.env.PROTOCOL}://${process.env.DOMAIN}/twilio/destiny/r`;

                if (!validateRequest(authToken, header, reconstructedUrl, sanitizedBody)) {
                    res.writeHead(StatusCodes.FORBIDDEN);

                    return res.end();
                }

                const { cookies = {}, media, message } = await twilioController.request({
                    body: sanitizedBody,
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
            const { error: err, value: sanitizedBody } = bodySchema.validate(body);

            if (err) {
                return res.status(StatusCodes.BAD_REQUEST).json({ error: err.details[0].message });
            }

            if (!validateRequest(authToken, header, `${process.env.PROTOCOL}://${process.env.DOMAIN}${originalUrl}`, sanitizedBody)) {
                res.writeHead(StatusCodes.FORBIDDEN);

                return res.end();
            }

            await twilioController.statusCallback({
                ...sanitizedBody,
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
