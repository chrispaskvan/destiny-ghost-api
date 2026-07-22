/**
 * Twilio inbound and outbound request URLs. See the article
 * at {@link https://twilio.radicalskills.com/projects/getting-started-with-twiml/1.html}
 * for instructions on how to debug these routes locally. Remember
 * to update the DOMAIN environment variable.
 */
import cookieParser from 'cookie-parser';
import { Router } from 'express';
import { StatusCodes } from 'http-status-codes';
import twilio from 'twilio';
import { z } from 'zod';

import AuthenticationMiddleWare from '../authentication/authentication.middleware.js';
import TwilioController from './twilio.controller.js';
import configuration from '../helpers/config.js';

const {
    twiml: { MessagingResponse },
    validateRequest,
} = twilio;
const {
    twilio: { attributes, authToken },
} = configuration;

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
        authenticationService,
        destinyService,
        userService,
        worldRepository,
    });

    // Define a schema for the expected body parameters
    const bodySchema = z.object({
        MessageSid: z.string().length(34),
        SmsSid: z.string().length(34),
        SmsMessageSid: z.string().length(34),
        AccountSid: z.string().length(34),
        MessagingServiceSid: z.string().length(34),
        From: z.string(),
        To: z.string(),
        Body: z.string().max(1600),
        NumMedia: z.coerce.number().int().min(0),
    });

    twilioRouter.route('/destiny/r').post(
        (req, res, next) => {
            const header = req.headers['x-twilio-signature'];
            const reconstructedUrl = `${process.env.PROTOCOL}://${process.env.DOMAIN}/twilio/destiny/r`;

            if (!validateRequest(authToken, header, reconstructedUrl, req.body)) {
                res.writeHead(StatusCodes.FORBIDDEN);

                return res.end();
            }

            return next();
        },
        /**
         * Twilio echoes this cookie back on subsequent SMS/MMS webhook requests
         * from the same phone number, used below to carry conversation state
         * (last item hash, registration gate) between messages. Scoped to this
         * route (and placed after the signature check) since it's the only
         * Twilio endpoint that consumes `req.cookies`.
         */
        cookieParser(),
        (req, res, next) => {
            try {
                bodySchema.parse(req.body);

                return next();
            } catch (err) {
                return res.status(StatusCodes.BAD_REQUEST).json({ error: err.issues[0].message });
            }
        },
        (req, res, next) => middleware.authenticateUser(req, res, next),
        async (req, res) => {
            const { body, cookies: requestCookies = {} } = req;
            const {
                cookies = {},
                media,
                message,
            } = await twilioController.request({
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
        },
    );

    twilioRouter.route('/destiny/s').post(async (req, res) => {
        const header = req.headers['x-twilio-signature'];
        const { body, query = {}, originalUrl } = req;
        const claimCheck = query['claim-check-number'];
        const notificationType = query['notification-type'];

        try {
            bodySchema.parse(body);
        } catch (err) {
            return res.status(StatusCodes.BAD_REQUEST).json({ error: err.issues[0].message });
        }

        if (
            !validateRequest(
                authToken,
                header,
                `${process.env.PROTOCOL}://${process.env.DOMAIN}${originalUrl}`,
                body,
            )
        ) {
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

    twilioRouter.route('/destiny/f').post((_req, res) => {
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
