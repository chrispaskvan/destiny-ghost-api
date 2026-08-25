import { EventEmitter } from 'node:events';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { StatusCodes } from 'http-status-codes';
import { createResponse, createRequest } from 'node-mocks-http';
import twilio from 'twilio';
import MmsService from './mms.service.js';
import TwilioRouter from './twilio.routes.js';
import TwilioController from './twilio.controller.js';
import configuration from '../helpers/config.js';
import {
    MAX_SMS_MESSAGE_LENGTH,
    MEDIA_RECEIVED_REPLY,
    MEDIA_UNSUPPORTED_REPLY,
} from './twilio.constants.js';

vi.mock('../helpers/bitly.js', () => ({
    default: vi.fn().mockResolvedValue('https://bit.ly/short'),
}));

const { getExpectedTwilioSignature } = twilio;
const { authToken } = configuration.twilio;

/**
 * Read PROTOCOL/DOMAIN at call time, not into a module-scope constant: the
 * route handler under test (twilio.routes.js) reconstructs this same URL
 * per-request rather than caching it, and other spec files (e.g.
 * helpers/director.client.spec.js) temporarily mutate process.env.PROTOCOL,
 * so caching it here risks signing against a stale value.
 */
function getUrl() {
    return `${process.env.PROTOCOL}://${process.env.DOMAIN}/twilio/destiny/r`;
}

/**
 * `bodySchema` in twilio.routes.js requires SID-shaped strings of exactly 34
 * characters for these fields.
 */
const sid = prefix => prefix.padEnd(34, '0');

function signedBody(overrides = {}) {
    return {
        MessageSid: sid('SM'),
        SmsSid: sid('SM'),
        SmsMessageSid: sid('SM'),
        AccountSid: sid('AC'),
        MessagingServiceSid: sid('MG'),
        From: '+15005550006',
        To: '+15005550001',
        Body: 'more',
        NumMedia: '0',
        ...overrides,
    };
}

function signedRequest({ body, cookie }) {
    const signature = getExpectedTwilioSignature(authToken, getUrl(), body);
    const req = createRequest({
        method: 'POST',
        url: '/destiny/r',
        body,
        headers: {
            'x-twilio-signature': signature,
            ...(cookie && { cookie }),
        },
    });

    /**
     * node-mocks-http always initializes `req.cookies` to `{}`, which is truthy
     * and short-circuits cookie-parser's own "already parsed" guard. A real
     * `http.IncomingMessage` has no such property, so remove it to let
     * cookie-parser actually run, the way it does in production.
     */
    delete req.cookies;

    return req;
}

const authenticationController = {
    authenticate: vi.fn(() => ({ displayName: 'test-user', membershipType: 2 })),
};
const authenticationService = { authenticate: vi.fn() };
const destinyService = {};
const notificationService = { sendMessage: vi.fn() };
const userService = {
    addUserMessage: vi.fn(),
    getUserByPhoneNumber: vi.fn(),
    updateUser: vi.fn(),
};
const worldRepository = {};

let twilioRouter;

beforeEach(() => {
    vi.clearAllMocks();
    userService.getUserByPhoneNumber.mockResolvedValue({
        dateRegistered: Temporal.Now.instant().toString(),
        type: 'mobile',
    });

    twilioRouter = TwilioRouter({
        authenticationController,
        authenticationService,
        destinyService,
        notificationService,
        userService,
        worldRepository,
    });
});

describe('TwilioRouter', () => {
    const next = vi.fn();
    let res;

    beforeEach(() => {
        res = createResponse({
            eventEmitter: EventEmitter,
        });
    });

    describe('POST /destiny/r', () => {
        describe('when the request carries a cookie from a prior message', () => {
            it('should read the itemHash cookie via cookie-parser and answer the follow-up', () =>
                new Promise((done, reject) => {
                    const body = signedBody();
                    const req = signedRequest({ body, cookie: 'itemHash=test-item-hash' });

                    res.on('end', () => {
                        try {
                            expect(res.statusCode).toEqual(StatusCodes.OK);
                            expect(req.cookies).toEqual({ itemHash: 'test-item-hash' });
                            expect(res._getData()).toContain('bit.ly/short');
                            done();
                        } catch (err) {
                            reject(err);
                        }
                    });

                    twilioRouter(req, res, next);
                }));
        });

        describe('when the request carries no cookie', () => {
            it('should treat the follow-up as having no prior item', () =>
                new Promise((done, reject) => {
                    const body = signedBody();
                    const req = signedRequest({ body });

                    res.on('end', () => {
                        try {
                            expect(res.statusCode).toEqual(StatusCodes.OK);
                            expect(req.cookies).toEqual({});
                            expect(res._getData()).toContain('More what?');
                            expect(res._getData()).toContain('Destiny-Ghost: ');
                            done();
                        } catch (err) {
                            reject(err);
                        }
                    });

                    twilioRouter(req, res, next);
                }));
        });

        describe('when the message body is STOP', () => {
            it('should unsubscribe the user and reply with the opt-out confirmation', () =>
                new Promise((done, reject) => {
                    const body = signedBody({ Body: 'STOP' });
                    const req = signedRequest({ body });

                    res.on('end', () => {
                        try {
                            expect(res.statusCode).toEqual(StatusCodes.OK);
                            expect(res._getData()).toContain("You're unsubscribed");
                            expect(res._getData()).toContain('Destiny-Ghost: ');
                            expect(userService.updateUser).toHaveBeenCalledWith(
                                expect.objectContaining({ isSubscribed: false }),
                            );
                            done();
                        } catch (err) {
                            reject(err);
                        }
                    });

                    twilioRouter(req, res, next);
                }));
        });

        describe('when the message body is HELP', () => {
            it('should reply with support information without changing subscription state', () =>
                new Promise((done, reject) => {
                    const body = signedBody({ Body: 'HELP' });
                    const req = signedRequest({ body });

                    res.on('end', () => {
                        try {
                            expect(res.statusCode).toEqual(StatusCodes.OK);
                            expect(res._getData()).toContain('banshee-44@destiny-ghost.com');
                            expect(res._getData()).toContain('Destiny-Ghost: ');
                            expect(userService.updateUser).not.toHaveBeenCalled();
                            done();
                        } catch (err) {
                            reject(err);
                        }
                    });

                    twilioRouter(req, res, next);
                }));
        });

        describe('when the message body is START', () => {
            it('should re-subscribe the user and reply with the opt-in confirmation', () =>
                new Promise((done, reject) => {
                    const body = signedBody({ Body: 'START' });
                    const req = signedRequest({ body });

                    res.on('end', () => {
                        try {
                            expect(res.statusCode).toEqual(StatusCodes.OK);
                            expect(res._getData()).toContain("You're re-subscribed");
                            expect(res._getData()).toContain('Destiny-Ghost: ');
                            expect(userService.updateUser).toHaveBeenCalledWith(
                                expect.objectContaining({ isSubscribed: true }),
                            );
                            done();
                        } catch (err) {
                            reject(err);
                        }
                    });

                    twilioRouter(req, res, next);
                }));
        });

        describe('when getXur encounters an unexpected error', () => {
            it('should reply with a branded message instead of silently failing', () =>
                new Promise((done, reject) => {
                    authenticationService.authenticate.mockRejectedValue(new Error('boom'));

                    const body = signedBody({ Body: 'xur' });
                    const req = signedRequest({ body });

                    res.on('end', () => {
                        try {
                            expect(res.statusCode).toEqual(StatusCodes.OK);
                            expect(res._getData()).toContain('Destiny-Ghost: ');
                            done();
                        } catch (err) {
                            reject(err);
                        }
                    });

                    twilioRouter(req, res, next);
                }));
        });

        describe('when the reply is already at the max SMS length before branding', () => {
            it('should truncate the branded message so it does not exceed MAX_SMS_MESSAGE_LENGTH', () =>
                new Promise((done, reject) => {
                    const requestSpy = vi
                        .spyOn(TwilioController.prototype, 'request')
                        .mockResolvedValue({
                            cookies: {},
                            message: 'x'.repeat(MAX_SMS_MESSAGE_LENGTH),
                        });

                    const body = signedBody();
                    const req = signedRequest({ body });

                    res.on('end', () => {
                        try {
                            expect(res.statusCode).toEqual(StatusCodes.OK);

                            const [, messageBody] =
                                res._getData().match(/<Message[^>]*>([\s\S]*)<\/Message>/) ?? [];

                            expect(messageBody.length).toEqual(MAX_SMS_MESSAGE_LENGTH);
                            expect(messageBody.startsWith('Destiny-Ghost: ')).toBe(true);
                            done();
                        } catch (err) {
                            reject(err);
                        } finally {
                            requestSpy.mockRestore();
                        }
                    });

                    twilioRouter(req, res, next);
                }));
        });

        describe('when the user has opted out', () => {
            it('should suppress further replies with an empty 200 response, not a webhook error', () =>
                new Promise((done, reject) => {
                    userService.getUserByPhoneNumber.mockResolvedValue({
                        dateRegistered: Temporal.Now.instant().toString(),
                        type: 'mobile',
                        isSubscribed: false,
                    });

                    const body = signedBody();
                    const req = signedRequest({ body });

                    res.on('end', () => {
                        try {
                            expect(res.statusCode).toEqual(StatusCodes.OK);
                            expect(res._getData()).not.toContain('Destiny-Ghost: ');
                            done();
                        } catch (err) {
                            reject(err);
                        }
                    });

                    twilioRouter(req, res, next);
                }));
        });

        describe('when the message includes an image attachment', () => {
            it('should acknowledge receipt and process the media in the background', () =>
                new Promise((done, reject) => {
                    const processSpy = vi
                        .spyOn(MmsService.prototype, 'process')
                        .mockResolvedValue();
                    const body = signedBody({
                        Body: '',
                        NumMedia: '1',
                        MediaContentType0: 'image/jpeg',
                        MediaUrl0: `https://api.twilio.com/2010-04-01/Accounts/${sid('AC')}/Messages/${sid('MM')}/Media/${sid('ME')}`,
                    });
                    const req = signedRequest({ body });

                    res.on('end', () => {
                        try {
                            expect(res.statusCode).toEqual(StatusCodes.OK);
                            expect(res._getData()).toContain(MEDIA_RECEIVED_REPLY);
                            expect(processSpy).toHaveBeenCalledWith({
                                from: body.From,
                                media: [{ contentType: 'image/jpeg', url: body.MediaUrl0 }],
                            });
                            done();
                        } catch (err) {
                            reject(err);
                        } finally {
                            processSpy.mockRestore();
                        }
                    });

                    twilioRouter(req, res, next);
                }));
        });

        describe('when the attachment is not an image', () => {
            it('should reply that only images are supported without downloading anything', () =>
                new Promise((done, reject) => {
                    const processSpy = vi
                        .spyOn(MmsService.prototype, 'process')
                        .mockResolvedValue();
                    const body = signedBody({
                        Body: '',
                        NumMedia: '1',
                        MediaContentType0: 'video/mp4',
                        MediaUrl0: `https://api.twilio.com/2010-04-01/Accounts/${sid('AC')}/Messages/${sid('MM')}/Media/${sid('ME')}`,
                    });
                    const req = signedRequest({ body });

                    res.on('end', () => {
                        try {
                            expect(res.statusCode).toEqual(StatusCodes.OK);
                            expect(res._getData()).toContain(MEDIA_UNSUPPORTED_REPLY);
                            expect(processSpy).not.toHaveBeenCalled();
                            done();
                        } catch (err) {
                            reject(err);
                        } finally {
                            processSpy.mockRestore();
                        }
                    });

                    twilioRouter(req, res, next);
                }));
        });

        describe('when an unregistered number texts STOP', () => {
            it('should still confirm the opt-out without persisting a user record', () =>
                new Promise((done, reject) => {
                    userService.getUserByPhoneNumber.mockResolvedValue(null);

                    const body = signedBody({ Body: 'STOP' });
                    const req = signedRequest({ body });

                    res.on('end', () => {
                        try {
                            expect(res.statusCode).toEqual(StatusCodes.OK);
                            expect(res._getData()).toContain("You're unsubscribed");
                            expect(res._getData()).toContain('Destiny-Ghost: ');
                            expect(userService.updateUser).not.toHaveBeenCalled();
                            done();
                        } catch (err) {
                            reject(err);
                        }
                    });

                    twilioRouter(req, res, next);
                }));
        });
    });

    describe('POST /destiny/f', () => {
        it('should reply with a branded fallback message', () =>
            new Promise((done, reject) => {
                const req = createRequest({ method: 'POST', url: '/destiny/f' });

                res.on('end', () => {
                    try {
                        expect(res.statusCode).toEqual(StatusCodes.OK);
                        expect(res._getData()).toContain('Destiny-Ghost: ');
                        done();
                    } catch (err) {
                        reject(err);
                    }
                });

                twilioRouter(req, res, next);
            }));

        describe('when the fallback message is already at the max SMS length before branding', () => {
            it('should truncate the branded message so it does not exceed MAX_SMS_MESSAGE_LENGTH', () =>
                new Promise((done, reject) => {
                    const errorSpy = vi
                        .spyOn(TwilioController, 'getRandomResponseForAnError')
                        .mockReturnValue('x'.repeat(MAX_SMS_MESSAGE_LENGTH));

                    const req = createRequest({ method: 'POST', url: '/destiny/f' });

                    res.on('end', () => {
                        try {
                            expect(res.statusCode).toEqual(StatusCodes.OK);

                            const [, messageBody] =
                                res._getData().match(/<Message[^>]*>([\s\S]*)<\/Message>/) ?? [];

                            expect(messageBody.length).toEqual(MAX_SMS_MESSAGE_LENGTH);
                            done();
                        } catch (err) {
                            reject(err);
                        } finally {
                            errorSpy.mockRestore();
                        }
                    });

                    twilioRouter(req, res, next);
                }));
        });
    });
});
