// @ts-check
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
import { BRAND_PREFIX, MAX_SMS_MESSAGE_LENGTH } from './twilio.constants.js';

const {
    twiml: { MessagingResponse },
    validateRequest,
} = twilio;
const {
    twilio: { attributes, authToken },
} = configuration;

/**
 * @typedef {Object} TwilioRoutesOptions
 * @property {unknown} authenticationController
 * @property {import('../authentication/authentication.service.js').default} authenticationService
 * @property {import('../destiny2/destiny2.service.js').default} destinyService
 * @property {import('./mms.service.js').default} mmsService
 * @property {import('../users/user.service.js').default} userService
 * @property {import('../helpers/world2.js').default} worldRepository
 */

/**
 * @param {TwilioRoutesOptions} options
 */
const routes = ({
    authenticationController,
    authenticationService,
    destinyService,
    mmsService,
    userService,
    worldRepository,
}) => {
    const middleware = new AuthenticationMiddleWare({ authenticationController });
    const twilioRouter = Router();
    const twilioController = new TwilioController({
        authenticationService,
        destinyService,
        mmsService,
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

    /**
     * Twilio's Messaging status-callback webhook (`/destiny/s`) carries a
     * different, smaller payload than an inbound message (`/destiny/r`) - it
     * has no `Body`, `NumMedia`, `SmsMessageSid`, or `MessagingServiceSid`.
     * Validating it against `bodySchema` would reject real status callbacks.
     */
    const statusCallbackBodySchema = z.object({
        MessageSid: z.string().length(34),
        SmsSid: z.string().length(34).optional(),
        AccountSid: z.string().length(34),
        From: z.string(),
        To: z.string(),
        MessageStatus: z.string().optional(),
        SmsStatus: z.string().optional(),
    });

    twilioRouter.route('/destiny/r').post(
        (req, res, next) => {
            const rawHeader = req.headers['x-twilio-signature'];
            const header = Array.isArray(rawHeader) ? (rawHeader[0] ?? '') : (rawHeader ?? '');
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
                const message = err instanceof z.ZodError ? err.issues[0].message : 'Bad Request';

                return res.status(StatusCodes.BAD_REQUEST).json({ error: message });
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
                /**
                 * A missing message means the reply is intentionally
                 * suppressed (e.g. an opted-out user), not that the request
                 * failed - reply 200 with empty TwiML so Twilio doesn't
                 * treat this as an error and retry the webhook.
                 */
                res.writeHead(StatusCodes.OK, {
                    'Content-Type': 'text/xml',
                });

                return res.end(new MessagingResponse().toString());
            }

            for (const [key, value] of Object.entries(cookies)) {
                if (value) {
                    res.cookie(key, value);
                } else {
                    res.clearCookie(key);
                }
            }

            const twiml = new MessagingResponse();
            const brandedMessage = `${BRAND_PREFIX}${message}`.substring(0, MAX_SMS_MESSAGE_LENGTH);

            if (media) {
                twiml.message(attributes, brandedMessage).media(media);
            } else {
                twiml.message(attributes, brandedMessage);
            }
            res.writeHead(StatusCodes.OK, {
                'Content-Type': 'text/xml',
            });

            return res.end(twiml.toString());
        },
    );

    twilioRouter.route('/destiny/s').post(async (req, res) => {
        const rawHeader = req.headers['x-twilio-signature'];
        const header = Array.isArray(rawHeader) ? (rawHeader[0] ?? '') : (rawHeader ?? '');
        const { body, query = {}, originalUrl } = req;
        const claimCheck = query['claim-check-number'];
        const notificationType = query['notification-type'];

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

        try {
            statusCallbackBodySchema.parse(body);
        } catch (err) {
            const message = err instanceof z.ZodError ? err.issues[0].message : 'Bad Request';

            return res.status(StatusCodes.BAD_REQUEST).json({ error: message });
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

        twiml.message(attributes, `${BRAND_PREFIX}${message}`.substring(0, MAX_SMS_MESSAGE_LENGTH));
        res.writeHead(StatusCodes.OK, {
            'Content-Type': 'text/xml',
        });
        res.end(twiml.toString());
    });

    return twilioRouter;
};

export default routes;
