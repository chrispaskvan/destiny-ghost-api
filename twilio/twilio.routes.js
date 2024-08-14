/**
 * Twilio inbound and outbound request URLs. See the article
 * at {@link https://twilio.radicalskills.com/projects/getting-started-with-twiml/1.html}
 * for instructions on how to debug these routes locally. Remember
 * to update the DOMAIN environment variable.
 */
import { Router } from 'express';
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
        .post(
            (req, res, next) => middleware.authenticateUser(req, res, next),
            (req, res, next) => {
                const header = req.headers['x-twilio-signature'];
                const {
                    body,
                    cookies: requestCookies = {},
                    originalUrl,
                } = req;

                if (!validateRequest(authToken, header, `${process.env.PROTOCOL}://${process.env.DOMAIN}${originalUrl}`, body)) {
                    res.writeHead(403);

                    return res.end();
                }

                return twilioController.request({
                    body,
                    cookies: requestCookies,
                })
                    .then(({ cookies = {}, media, message }) => {
                        if (!message) {
                            res.writeHead(403);

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
                        res.writeHead(200, {
                            'Content-Type': 'text/xml',
                        });

                        return res.end(twiml.toString());
                    })
                    .catch(next);
            },
        );

    twilioRouter.route('/destiny/s')
        .post((req, res, next) => {
            const header = req.headers['x-twilio-signature'];
            const {
                body,
                query = {},
                originalUrl,
            } = req;
            const claimCheck = query['claim-check-number'];
            const notificationType = query['notification-type'];

            if (!validateRequest(authToken, header, `${process.env.PROTOCOL}://${process.env.DOMAIN}${originalUrl}`, body)) {
                res.writeHead(403);

                return res.end();
            }

            return twilioController.statusCallback({
                ...body,
                ...(claimCheck && { ClaimCheck: claimCheck }),
                ...(notificationType && { NotificationType: notificationType }),
            })
                .then(() => {
                    const twiml = new MessagingResponse();

                    res.writeHead(200, {
                        'Content-Type': 'text/xml',
                    });
                    res.end(twiml.toString());
                })
                .catch(next);
        });

    twilioRouter.route('/destiny/f')
        .post((req, res, next) => {
            try {
                const message = TwilioController.fallback();
                const twiml = new MessagingResponse();

                twiml.message(attributes, message);
                res.writeHead(200, {
                    'Content-Type': 'text/xml',
                });
                res.end(twiml.toString());
            } catch (err) {
                next(err);
            }
        });

    return twilioRouter;
};

export default routes;
