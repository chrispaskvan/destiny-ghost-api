import { EventEmitter } from 'node:events';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { StatusCodes } from 'http-status-codes';
import { createResponse, createRequest } from 'node-mocks-http';
import { Router } from 'express';
import twilio from 'twilio';
import MmsService from './mms.service.js';
import TwilioRouter from './twilio.routes.js';
import TwilioController from './twilio.controller.js';
import UserService from '../users/user.service.js';
import configuration from '../helpers/config.js';
import log from '../helpers/log.js';
import rateLimiterMiddleware, {
    twilioPreflightMiddleware,
} from '../helpers/rate-limiter.middleware.js';
import {
    EMOJI_DEFAULT_REPLY,
    EMOJI_INTENT_REPLIES,
    MAX_SMS_MESSAGE_LENGTH,
    MEDIA_RECEIVED_REPLY,
    MEDIA_UNSUPPORTED_REPLY,
    STOP_KEYWORDS,
    HELP_KEYWORDS,
    START_KEYWORDS,
} from './twilio.constants.js';

const { enqueueConsentChange, listen } = vi.hoisted(() => ({
    enqueueConsentChange: vi.fn(),
    listen: vi.fn(),
}));

vi.mock('./consent.queue.js', () => ({
    default: {},
    enqueueConsentChange,
    QUEUE_NAME: 'consent',
}));

/**
 * The controller registers a BullMQ worker on construction; without this the
 * spec would open a real connection for every router it builds.
 */
vi.mock('../helpers/subscriber.js', () => ({
    default: { listen, close: vi.fn() },
}));

const {
    consume,
    ingressConsume,
    browserConsume,
    callbackConsume,
    fallbackConsume,
    invalidConsume,
    invalidGet,
    MockRateLimiterRes,
} = vi.hoisted(() => ({
    consume: vi.fn(),
    ingressConsume: vi.fn(),
    browserConsume: vi.fn(),
    callbackConsume: vi.fn(),
    fallbackConsume: vi.fn(),
    invalidConsume: vi.fn(),
    invalidGet: vi.fn(),
    MockRateLimiterRes: class RateLimiterRes {},
}));

vi.mock('rate-limiter-flexible', () => ({
    RateLimiterRedis: class {
        constructor({ points, keyPrefix }) {
            this.points = points;
            this.consume = {
                austringer: browserConsume,
                'twilio-ingress': ingressConsume,
                'twilio-sender': consume,
                'twilio-callback': callbackConsume,
                'twilio-fallback': fallbackConsume,
                'twilio-invalid': invalidConsume,
            }[keyPrefix];
            this.get = invalidGet;
        }
    },
    RateLimiterRes: MockRateLimiterRes,
}));

vi.mock('../helpers/bitly.js', () => ({
    default: vi.fn().mockResolvedValue('https://bit.ly/short'),
}));

/**
 * twilio.controller.js imports ClaimCheck, which imports helpers/cache.js.
 * cache.js connects to Redis at module load time, which hangs/fails in a
 * test environment with no Redis available. Mock it explicitly (factory
 * function, matching helpers/claim-check.spec.js) rather than relying on
 * Vitest automocking, which still executes the real module body first.
 */
vi.mock('../helpers/cache.js', () => ({
    default: {
        isReady: true,
        hSet: vi.fn(),
        hGet: vi.fn(),
        hGetAll: vi.fn(),
        expire: vi.fn(),
    },
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
function getUrl(path = '/destiny/r') {
    return `${process.env.PROTOCOL}://${process.env.DOMAIN}/twilio${path}`;
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

function signedRequest({ body, cookie, path = '/destiny/r' }) {
    const signature = getExpectedTwilioSignature(authToken, getUrl(path), body);
    const req = createRequest({
        method: 'POST',
        url: path,
        originalUrl: `/twilio${path}`,
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

/**
 * Twilio's Messaging status-callback payload is smaller than an inbound
 * message's - no `Body`, `NumMedia`, `SmsMessageSid`, or
 * `MessagingServiceSid` - matching `statusCallbackBodySchema` in
 * twilio.routes.js.
 */
function signedStatusBody(overrides = {}) {
    return {
        MessageSid: sid('SM'),
        SmsSid: sid('SM'),
        AccountSid: sid('AC'),
        From: '+15005550006',
        To: '+15005550001',
        ...overrides,
    };
}

function getStatusCallbackUrl() {
    return `${process.env.PROTOCOL}://${process.env.DOMAIN}/twilio/destiny/s`;
}

function signedStatusRequest({ body, signature: signatureOverride }) {
    const signature =
        signatureOverride ?? getExpectedTwilioSignature(authToken, getStatusCallbackUrl(), body);

    /**
     * Unlike /destiny/r, this route reconstructs its signed URL from
     * req.originalUrl rather than a hardcoded path. node-mocks-http defaults
     * originalUrl to the `url` option, which lacks the /twilio prefix Express
     * adds in production (routes.use('/twilio', twilioRouter) in
     * loaders/routes.js), so it's set explicitly here to match reality.
     */
    return createRequest({
        method: 'POST',
        url: '/destiny/s',
        originalUrl: '/twilio/destiny/s',
        body,
        headers: {
            'x-twilio-signature': signature,
        },
    });
}

const authenticationService = { authenticate: vi.fn() };
const destinyService = { getProfile: vi.fn() };
const mmsService = new MmsService({ notificationService: { sendMessage: vi.fn() } });
const userService = {
    addUserMessage: vi.fn(),
    getUserByPhoneNumber: vi.fn(),
    updateUser: vi.fn(),
    updateUserSubscription: vi.fn(),
};
const worldRepository = { getItemByName: vi.fn() };

let twilioRouter;

function dispatch(router, req, res) {
    return new Promise((resolve, reject) => {
        res.on('end', resolve);
        router(req, res, reject);
    });
}

beforeEach(() => {
    vi.clearAllMocks();
    consume.mockReset().mockResolvedValue({ remainingPoints: 19, msBeforeNext: 60000 });
    ingressConsume.mockReset().mockResolvedValue({ remainingPoints: 999, msBeforeNext: 1000 });
    callbackConsume.mockReset().mockResolvedValue({ remainingPoints: 999, msBeforeNext: 1000 });
    fallbackConsume.mockReset().mockResolvedValue({ remainingPoints: 999, msBeforeNext: 1000 });
    invalidConsume.mockReset().mockResolvedValue({ remainingPoints: 9, msBeforeNext: 1000 });
    invalidGet.mockReset().mockResolvedValue(null);
    browserConsume.mockReset().mockResolvedValue({ remainingPoints: 90, msBeforeNext: 1000 });
    destinyService.getProfile.mockResolvedValue([]);
    authenticationService.authenticate.mockResolvedValue({
        displayName: 'test-user',
        membershipType: 2,
        membershipId: 'test-membership',
        bungie: { access_token: 'test-token' },
        dateRegistered: Temporal.Now.instant().toString(),
        type: 'mobile',
    });
    userService.getUserByPhoneNumber.mockResolvedValue({
        displayName: 'test-user',
        membershipType: 2,
        dateRegistered: Temporal.Now.instant().toString(),
        type: 'mobile',
    });
    userService.updateUser.mockReset().mockResolvedValue(undefined);
    userService.updateUserSubscription.mockReset().mockResolvedValue(undefined);
    /**
     * Default the queue to unavailable so every consent test below exercises
     * the inline fallback - the path that has to keep working when Redis is
     * down. The queue path has its own tests, which opt back in.
     */
    enqueueConsentChange.mockReset().mockRejectedValue(new Error('queue unavailable'));
    worldRepository.getItemByName.mockResolvedValue([]);

    twilioRouter = TwilioRouter({
        authenticationService,
        destinyService,
        mmsService,
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
        it.each(['lookup', 'write'])(
            'preserves compliance replies when consent %s rejects',
            async operation => {
                const error = new Error('Consent persistence unavailable');
                const errorLog = vi.spyOn(log, 'error').mockImplementation(() => {});
                const dependency =
                    operation === 'lookup'
                        ? userService.getUserByPhoneNumber
                        : userService.updateUserSubscription;
                dependency.mockRejectedValue(error);

                try {
                    for (const keyword of [...STOP_KEYWORDS, ...START_KEYWORDS, ...HELP_KEYWORDS]) {
                        const response = createResponse({ eventEmitter: EventEmitter });
                        await dispatch(
                            twilioRouter,
                            signedRequest({ body: signedBody({ Body: keyword }) }),
                            response,
                        );
                        expect(response.statusCode).toBe(StatusCodes.OK);
                        expect(response._getData()).toContain(
                            STOP_KEYWORDS.has(keyword)
                                ? "You're unsubscribed"
                                : START_KEYWORDS.has(keyword)
                                  ? "You're re-subscribed"
                                  : 'banshee-44@destiny-ghost.com',
                        );
                    }
                    await new Promise(resolve => setImmediate(resolve));
                    expect(errorLog).toHaveBeenCalledTimes(
                        STOP_KEYWORDS.size + START_KEYWORDS.size,
                    );
                    expect(errorLog).toHaveBeenCalledWith(
                        expect.objectContaining({ err: error, phoneNumber: signedBody().From }),
                        'Unable to persist SMS consent change after retrying; the sender was told it applied.',
                    );
                    expect(consume).not.toHaveBeenCalled();
                    expect(authenticationService.authenticate).not.toHaveBeenCalled();
                    expect(userService.addUserMessage).not.toHaveBeenCalled();
                } finally {
                    errorLog.mockRestore();
                }
            },
        );

        it.each(['lookup', 'write'])(
            'replies before an unresolved consent %s completes',
            async operation => {
                const pending = Promise.withResolvers();
                const dependency =
                    operation === 'lookup'
                        ? userService.getUserByPhoneNumber
                        : userService.updateUserSubscription;
                dependency.mockReturnValue(pending.promise);

                try {
                    for (const keyword of ['STOP', 'START', 'HELP']) {
                        const response = createResponse({ eventEmitter: EventEmitter });
                        await dispatch(
                            twilioRouter,
                            signedRequest({ body: signedBody({ Body: keyword }) }),
                            response,
                        );
                        expect(response.statusCode).toBe(StatusCodes.OK);
                        expect(response._getData()).toContain(
                            keyword === 'STOP'
                                ? "You're unsubscribed"
                                : keyword === 'START'
                                  ? "You're re-subscribed"
                                  : 'banshee-44@destiny-ghost.com',
                        );
                    }
                    expect(dependency).toHaveBeenCalledTimes(2);
                } finally {
                    pending.resolve(undefined);
                    await new Promise(resolve => setImmediate(resolve));
                }
            },
        );

        it('retries a throttled consent write rather than losing the opt-out', async () => {
            const throttled = Object.assign(new Error('Request rate is large'), { code: 429 });
            const errorLog = vi.spyOn(log, 'error').mockImplementation(() => {});
            const warnLog = vi.spyOn(log, 'warn').mockImplementation(() => {});

            userService.updateUserSubscription
                .mockRejectedValueOnce(throttled)
                .mockRejectedValueOnce(throttled)
                .mockResolvedValueOnce(undefined);

            try {
                const response = createResponse({ eventEmitter: EventEmitter });

                await dispatch(
                    twilioRouter,
                    signedRequest({ body: signedBody({ Body: 'STOP' }) }),
                    response,
                );

                /**
                 * The reply must not wait for the write, so it is already out
                 * while the first attempt is still failing.
                 */
                expect(response.statusCode).toBe(StatusCodes.OK);
                expect(response._getData()).toContain("You're unsubscribed");

                await vi.waitFor(
                    () => expect(userService.updateUserSubscription).toHaveBeenCalledTimes(3),
                    { timeout: 15000 },
                );
                expect(userService.updateUserSubscription).toHaveBeenLastCalledWith(
                    expect.anything(),
                    false,
                );
                expect(errorLog).not.toHaveBeenCalled();
            } finally {
                errorLog.mockRestore();
                warnLog.mockRestore();
            }
        }, 20000);

        it('queues a consent change rather than writing it inline', async () => {
            enqueueConsentChange.mockResolvedValue({ id: 'job-1' });
            const response = createResponse({ eventEmitter: EventEmitter });

            await dispatch(
                twilioRouter,
                signedRequest({ body: signedBody({ Body: 'STOP' }) }),
                response,
            );
            await new Promise(resolve => setImmediate(resolve));

            expect(response.statusCode).toBe(StatusCodes.OK);
            expect(response._getData()).toContain("You're unsubscribed");
            expect(enqueueConsentChange).toHaveBeenCalledExactlyOnceWith({
                phoneNumber: signedBody().From,
                isSubscribed: false,
            });
            /**
             * The worker owns the write now, so nothing should touch Cosmos on
             * the request path.
             */
            expect(userService.updateUserSubscription).not.toHaveBeenCalled();
            expect(userService.getUserByPhoneNumber).not.toHaveBeenCalled();
        });

        it('registers the consent worker one job at a time', () => {
            /**
             * BullMQ hands a single worker its jobs in enqueue order, so a
             * STOP followed by a START settles on the later intent. Any higher
             * concurrency reintroduces the race this queue exists to remove.
             */
            expect(listen).toHaveBeenCalledWith(expect.any(Function), 'consent', {
                concurrency: 1,
            });
        });

        it('applies a queued consent change when the worker runs it', async () => {
            const [handler] = listen.mock.calls.at(-1);

            await handler({ phoneNumber: signedBody().From, isSubscribed: false });

            expect(userService.getUserByPhoneNumber).toHaveBeenCalledExactlyOnceWith(
                signedBody().From,
                true,
            );
            expect(userService.updateUserSubscription).toHaveBeenCalledExactlyOnceWith(
                expect.anything(),
                false,
            );
        });

        it('recovers a consent write rejected on a superseded etag', async () => {
            const preconditionFailed = Object.assign(new Error('precondition failed'), {
                code: 412,
            });
            const errorLog = vi.spyOn(log, 'error').mockImplementation(() => {});
            const warnLog = vi.spyOn(log, 'warn').mockImplementation(() => {});

            userService.updateUserSubscription
                .mockRejectedValueOnce(preconditionFailed)
                .mockResolvedValueOnce(undefined);

            try {
                const response = createResponse({ eventEmitter: EventEmitter });

                await dispatch(
                    twilioRouter,
                    signedRequest({ body: signedBody({ Body: 'STOP' }) }),
                    response,
                );

                expect(response.statusCode).toBe(StatusCodes.OK);
                expect(response._getData()).toContain("You're unsubscribed");

                await vi.waitFor(
                    () => expect(userService.updateUserSubscription).toHaveBeenCalledTimes(2),
                    { timeout: 15000 },
                );

                /**
                 * Every attempt must bypass the cache. Re-reading the cached
                 * copy would replay the same superseded etag and fail
                 * identically until the entry expired.
                 */
                expect(userService.getUserByPhoneNumber).toHaveBeenCalledTimes(2);
                for (const call of userService.getUserByPhoneNumber.mock.calls) {
                    expect(call).toEqual([signedBody().From, true]);
                }
                expect(errorLog).not.toHaveBeenCalled();
            } finally {
                errorLog.mockRestore();
                warnLog.mockRestore();
            }
        }, 20000);

        it('recovers through the real UserService when Cosmos rejects the etag', async () => {
            /**
             * The other consent tests stub `userService`, so the 412 they
             * produce never travels the code that actually has to survive it.
             * This one wires a real `UserService` over a stubbed Cosmos and
             * cache, so the rejection originates in `updateDocument` and flows
             * back through `#replaceAndCache` - which is what leaves the stale
             * entry behind when a write fails.
             */
            const storedUser = {
                id: 'user-1',
                displayName: 'test-user',
                membershipType: 2,
                phoneNumber: signedBody().From,
                isSubscribed: true,
            };
            const cacheStub = { getUser: vi.fn(), setUser: vi.fn().mockResolvedValue(undefined) };
            const documentStub = {
                getDocuments: vi
                    .fn()
                    .mockResolvedValueOnce([{ ...storedUser, _etag: 'etag-1' }])
                    .mockResolvedValueOnce([{ ...storedUser, _etag: 'etag-2' }]),
                updateDocument: vi.fn(async (_collection, document) => {
                    if (document._etag !== 'etag-2') {
                        throw Object.assign(new Error('precondition failed'), { code: 412 });
                    }

                    return { ...document, _etag: 'etag-3' };
                }),
            };
            const warnLog = vi.spyOn(log, 'warn').mockImplementation(() => {});
            const errorLog = vi.spyOn(log, 'error').mockImplementation(() => {});

            try {
                const router = TwilioRouter({
                    authenticationService,
                    destinyService,
                    mmsService,
                    userService: new UserService({
                        cacheService: cacheStub,
                        client: {},
                        documentService: documentStub,
                    }),
                    worldRepository,
                });
                const response = createResponse({ eventEmitter: EventEmitter });

                await dispatch(
                    router,
                    signedRequest({ body: signedBody({ Body: 'STOP' }) }),
                    response,
                );

                expect(response.statusCode).toBe(StatusCodes.OK);
                expect(response._getData()).toContain("You're unsubscribed");

                await vi.waitFor(
                    () => expect(documentStub.updateDocument).toHaveBeenCalledTimes(2),
                    { timeout: 15000 },
                );

                // The first attempt carried the superseded etag, the retry the current one.
                expect(documentStub.updateDocument.mock.calls[0][1]._etag).toBe('etag-1');
                expect(documentStub.updateDocument.mock.calls[1][1]._etag).toBe('etag-2');
                expect(documentStub.updateDocument.mock.calls[1][1].isSubscribed).toBe(false);

                // Both reads went to Cosmos; a cache hit would have replayed etag-1.
                expect(cacheStub.getUser).not.toHaveBeenCalled();
                expect(documentStub.getDocuments).toHaveBeenCalledTimes(2);

                // Only the successful write publishes fresh cache state.
                expect(cacheStub.setUser).toHaveBeenLastCalledWith(
                    expect.objectContaining({ _etag: 'etag-3', isSubscribed: false }),
                );
                expect(errorLog).not.toHaveBeenCalled();
            } finally {
                warnLog.mockRestore();
                errorLog.mockRestore();
            }
        }, 20000);

        it.each([
            ['STOP', false, "You're unsubscribed"],
            ['START', true, "You're re-subscribed"],
            ['yes', true, "You're re-subscribed"],
        ])(
            'replies to repeated %s without rewriting unchanged consent',
            async (keyword, isSubscribed, reply) => {
                userService.getUserByPhoneNumber.mockResolvedValue({
                    id: 'subscriber',
                    isSubscribed,
                    dateRegistered: '2026-09-19',
                });

                for (let attempt = 0; attempt < 2; attempt += 1) {
                    const response = createResponse({ eventEmitter: EventEmitter });
                    await dispatch(
                        twilioRouter,
                        signedRequest({ body: signedBody({ Body: keyword }) }),
                        response,
                    );
                    expect(response.statusCode).toBe(StatusCodes.OK);
                    expect(response._getData()).toContain(reply);
                }

                expect(userService.updateUserSubscription).not.toHaveBeenCalled();
                expect(consume).not.toHaveBeenCalled();
            },
        );

        it.each(['unknown', 'missing token', 'revoked token', 'legacy token'])(
            'handles consent for a sender with %s credentials without Bungie authorization',
            async state => {
                const user =
                    state === 'unknown'
                        ? undefined
                        : {
                              id: 'subscriber',
                              dateRegistered: '2026-09-19',
                              ...(state !== 'missing token' && {
                                  bungie: { access_token: 'unusable-token' },
                              }),
                          };
                userService.getUserByPhoneNumber.mockResolvedValue(user);
                authenticationService.authenticate.mockRejectedValue(new Error('revoked'));
                consume.mockRejectedValue(new MockRateLimiterRes());

                for (const keyword of [...STOP_KEYWORDS, ...HELP_KEYWORDS, ...START_KEYWORDS]) {
                    const response = createResponse({ eventEmitter: EventEmitter });
                    const req = signedRequest({ body: signedBody({ Body: keyword }) });

                    await dispatch(twilioRouter, req, response);

                    expect(response.statusCode).toBe(StatusCodes.OK);
                    expect(response._getData()).toContain('Destiny-Ghost: ');
                    if (STOP_KEYWORDS.has(keyword)) {
                        expect(response._getData()).toContain("You're unsubscribed");
                    }
                    if (START_KEYWORDS.has(keyword)) {
                        expect(response._getData()).toContain("You're re-subscribed");
                    }
                }

                expect(authenticationService.authenticate).not.toHaveBeenCalled();
                expect(consume).not.toHaveBeenCalled();
                expect(ingressConsume).toHaveBeenCalledTimes(
                    STOP_KEYWORDS.size + HELP_KEYWORDS.size + START_KEYWORDS.size,
                );
                if (user) {
                    expect(userService.updateUserSubscription).toHaveBeenCalledWith(user, false);
                    expect(userService.updateUserSubscription).toHaveBeenCalledWith(user, true);
                    expect(userService.updateUserSubscription).toHaveBeenCalledTimes(
                        STOP_KEYWORDS.size + START_KEYWORDS.size,
                    );
                } else {
                    expect(userService.updateUserSubscription).not.toHaveBeenCalled();
                }
            },
        );

        it('returns onboarding for an unknown sender without Bungie authentication', async () => {
            userService.getUserByPhoneNumber.mockResolvedValueOnce(undefined);
            const req = signedRequest({ body: signedBody() });

            await dispatch(twilioRouter, req, res);

            expect(res.statusCode).toBe(StatusCodes.OK);
            expect(res._getData()).toContain(
                `Register your phone at ${process.env.WEBSITE}/register`,
            );
            expect(authenticationService.authenticate).not.toHaveBeenCalled();
            expect(userService.addUserMessage).not.toHaveBeenCalled();
        });

        it.each(['missing credentials', 'failed refresh'])(
            'replies to Xur with %s without failing the webhook',
            async failure => {
                if (failure === 'missing credentials') {
                    authenticationService.authenticate.mockResolvedValueOnce(undefined);
                } else {
                    authenticationService.authenticate.mockRejectedValueOnce(
                        new Error('refresh failed'),
                    );
                }
                const req = signedRequest({ body: signedBody({ Body: 'xur' }) });

                await dispatch(twilioRouter, req, res);

                expect(res.statusCode).toBe(StatusCodes.OK);
                expect(res._getData()).toContain('Destiny-Ghost: ');
                expect(authenticationService.authenticate).toHaveBeenCalledTimes(1);
                expect(destinyService.getProfile).not.toHaveBeenCalled();
                if (failure === 'missing credentials') {
                    expect(res._getData()).toContain('Reconnect your Bungie account');
                }
            },
        );

        it('uses webhook limits under a different mount without reaching the browser limiter', async () => {
            const router = Router();
            router.use('/messages', twilioRouter);
            router.use(rateLimiterMiddleware);
            const body = signedBody();
            const req = signedRequest({ body });
            req.url = '/messages/destiny/r';
            req.originalUrl = req.url;
            req.headers['x-twilio-signature'] = getExpectedTwilioSignature(
                authToken,
                `${process.env.PROTOCOL}://${process.env.DOMAIN}${req.originalUrl}`,
                body,
            );

            await dispatch(router, req, res);

            expect(res.statusCode).toBe(StatusCodes.OK);
            expect(ingressConsume).toHaveBeenCalledExactlyOnceWith(req.ip, 1);
            expect(consume).toHaveBeenCalledExactlyOnceWith(body.From, 1);
            expect(browserConsume).not.toHaveBeenCalled();
        });

        it('acknowledges an over-limit signed sender with empty TwiML without handling the message', () =>
            new Promise((done, reject) => {
                consume.mockRejectedValueOnce(
                    Object.assign(new MockRateLimiterRes(), {
                        remainingPoints: 0,
                        msBeforeNext: 1000,
                    }),
                );
                const body = signedBody();
                const req = signedRequest({ body });

                res.on('end', () => {
                    try {
                        expect(res.statusCode).toBe(StatusCodes.OK);
                        expect(res.getHeader('Content-Type')).toBe('text/xml');
                        expect(res._getData()).toBe(
                            new twilio.twiml.MessagingResponse().toString(),
                        );
                        expect(res.getHeader('Retry-After')).toBeUndefined();
                        expect(consume).toHaveBeenCalledExactlyOnceWith(body.From, 1);
                        expect(authenticationService.authenticate).not.toHaveBeenCalled();
                        expect(userService.getUserByPhoneNumber).not.toHaveBeenCalled();
                        expect(worldRepository.getItemByName).not.toHaveBeenCalled();
                        done();
                    } catch (err) {
                        reject(err);
                    }
                });
                twilioRouter(req, res, reject);
            }));

        it('authenticates Xur once after identifying the sender', () =>
            new Promise((done, reject) => {
                const req = signedRequest({ body: signedBody({ Body: 'xur' }) });

                res.on('end', () => {
                    try {
                        expect(res.statusCode).toBe(StatusCodes.OK);
                        expect(authenticationService.authenticate).toHaveBeenCalledTimes(1);
                        expect(userService.getUserByPhoneNumber).toHaveBeenCalledExactlyOnceWith(
                            req.body.From,
                        );
                        expect(authenticationService.authenticate).toHaveBeenCalledWith(
                            expect.objectContaining({
                                displayName: 'test-user',
                                membershipType: 2,
                            }),
                        );
                        expect(destinyService.getProfile).toHaveBeenCalledExactlyOnceWith(
                            'test-membership',
                            2,
                        );
                        expect(res._getData()).toContain('Perhaps your Ghost');
                        done();
                    } catch (err) {
                        reject(err);
                    }
                });
                twilioRouter(req, res, reject);
            }));

        it.each([undefined, {}, { displayName: 'browser-user', membershipType: 1 }])(
            'identifies the signed sender without Bungie authentication or changing session %j',
            session =>
                new Promise((done, reject) => {
                    const body = signedBody();
                    const req = signedRequest({ body });
                    const originalSession = structuredClone(session);

                    req.session = session;
                    res.on('end', () => {
                        try {
                            expect(res.statusCode).toBe(StatusCodes.OK);
                            expect(authenticationService.authenticate).not.toHaveBeenCalled();
                            expect(req.session).toEqual(originalSession);
                            expect(
                                userService.getUserByPhoneNumber,
                            ).toHaveBeenCalledExactlyOnceWith(body.From);
                            expect(consume).toHaveBeenCalledExactlyOnceWith(body.From, 1);
                            expect(ingressConsume).toHaveBeenCalledExactlyOnceWith(req.ip, 1);
                            done();
                        } catch (err) {
                            reject(err);
                        }
                    });
                    twilioRouter(req, res, reject);
                }),
        );

        it.each(['missing signature', 'invalid signature', 'invalid body'])(
            'rejects %s without changing session identity',
            failure =>
                new Promise((done, reject) => {
                    const body = signedBody(failure === 'invalid body' ? { NumMedia: '-1' } : {});
                    const req = signedRequest({ body });
                    const expectedStatus = failure.includes('signature')
                        ? StatusCodes.FORBIDDEN
                        : StatusCodes.BAD_REQUEST;

                    req.session = {};
                    if (failure === 'missing signature') delete req.headers['x-twilio-signature'];
                    if (failure === 'invalid signature')
                        req.headers['x-twilio-signature'] = 'invalid';
                    res.on('end', () => {
                        try {
                            expect(res.statusCode).toBe(expectedStatus);
                            expect(req.session).toEqual({});
                            expect(userService.getUserByPhoneNumber).not.toHaveBeenCalled();
                            expect(authenticationService.authenticate).not.toHaveBeenCalled();
                            expect(consume).not.toHaveBeenCalled();
                            expect(ingressConsume).toHaveBeenCalledExactlyOnceWith(req.ip, 1);
                            done();
                        } catch (err) {
                            reject(err);
                        }
                    });
                    twilioRouter(req, res, reject);
                }),
        );

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

                    res.on('end', async () => {
                        try {
                            expect(res.statusCode).toEqual(StatusCodes.OK);
                            expect(res._getData()).toContain("You're unsubscribed");
                            expect(res._getData()).toContain('Destiny-Ghost: ');
                            await vi.waitFor(() =>
                                expect(userService.updateUserSubscription).toHaveBeenCalledWith(
                                    expect.anything(),
                                    false,
                                ),
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
                            expect(userService.getUserByPhoneNumber).not.toHaveBeenCalled();
                            expect(userService.updateUserSubscription).not.toHaveBeenCalled();
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

                    res.on('end', async () => {
                        try {
                            expect(res.statusCode).toEqual(StatusCodes.OK);
                            expect(res._getData()).toContain("You're re-subscribed");
                            expect(res._getData()).toContain('Destiny-Ghost: ');
                            await vi.waitFor(() =>
                                expect(userService.updateUserSubscription).toHaveBeenCalledWith(
                                    expect.anything(),
                                    true,
                                ),
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
                    destinyService.getProfile.mockRejectedValueOnce(new Error('boom'));

                    const body = signedBody({ Body: 'xur' });
                    const req = signedRequest({ body });

                    res.on('end', () => {
                        try {
                            expect(res.statusCode).toEqual(StatusCodes.OK);
                            expect(authenticationService.authenticate).toHaveBeenCalledTimes(1);
                            expect(destinyService.getProfile).toHaveBeenCalledExactlyOnceWith(
                                'test-membership',
                                2,
                            );
                            expect(
                                userService.getUserByPhoneNumber,
                            ).toHaveBeenCalledExactlyOnceWith(body.From);
                            expect(res._getData()).toContain('Destiny-Ghost: ');
                            done();
                        } catch (err) {
                            reject(err);
                        }
                    });

                    twilioRouter(req, res, reject);
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
            it('should confirm the opt-out without persisting a user record', () =>
                new Promise((done, reject) => {
                    userService.getUserByPhoneNumber.mockResolvedValueOnce(undefined);

                    const body = signedBody({ Body: 'STOP' });
                    const req = signedRequest({ body });

                    res.on('end', async () => {
                        try {
                            expect(res.statusCode).toEqual(StatusCodes.OK);
                            expect(res._getData()).toContain("You're unsubscribed");
                            expect(authenticationService.authenticate).not.toHaveBeenCalled();
                            expect(consume).not.toHaveBeenCalled();
                            expect(userService.updateUserSubscription).not.toHaveBeenCalled();
                            done();
                        } catch (err) {
                            reject(err);
                        }
                    });

                    twilioRouter(req, res, next);
                }));
        });

        describe('when the message is a single mapped emoji', () => {
            it('should reply with the mapped intent without attempting item search', () =>
                new Promise((done, reject) => {
                    const body = signedBody({ Body: '👍' });
                    const req = signedRequest({ body });

                    res.on('end', () => {
                        try {
                            expect(res.statusCode).toEqual(StatusCodes.OK);
                            expect(res._getData()).toContain(EMOJI_INTENT_REPLIES.get('👍'));
                            expect(worldRepository.getItemByName).not.toHaveBeenCalled();
                            done();
                        } catch (err) {
                            reject(err);
                        }
                    });

                    twilioRouter(req, res, next);
                }));
        });

        describe('when the message is a mapped emoji with a skin-tone modifier', () => {
            it('should reply with the mapped intent, not the default acknowledgment', () =>
                new Promise((done, reject) => {
                    const body = signedBody({ Body: '👎🏽' });
                    const req = signedRequest({ body });

                    res.on('end', () => {
                        try {
                            expect(res.statusCode).toEqual(StatusCodes.OK);
                            expect(res._getData()).toContain(EMOJI_INTENT_REPLIES.get('👎'));
                            expect(res._getData()).not.toContain(EMOJI_DEFAULT_REPLY);
                            done();
                        } catch (err) {
                            reject(err);
                        }
                    });

                    twilioRouter(req, res, next);
                }));
        });

        describe('when the message is a single unmapped emoji', () => {
            it('should reply with the default emoji acknowledgment', () =>
                new Promise((done, reject) => {
                    const body = signedBody({ Body: '🦄' });
                    const req = signedRequest({ body });

                    res.on('end', () => {
                        try {
                            expect(res.statusCode).toEqual(StatusCodes.OK);
                            expect(res._getData()).toContain(EMOJI_DEFAULT_REPLY);
                            expect(worldRepository.getItemByName).not.toHaveBeenCalled();
                            done();
                        } catch (err) {
                            reject(err);
                        }
                    });

                    twilioRouter(req, res, next);
                }));
        });

        describe('when the message is multiple emoji with no other mapped reply', () => {
            it('should reply based on the first emoji in the message', () =>
                new Promise((done, reject) => {
                    const body = signedBody({ Body: '👍🔥' });
                    const req = signedRequest({ body });

                    res.on('end', () => {
                        try {
                            expect(res.statusCode).toEqual(StatusCodes.OK);
                            expect(res._getData()).toContain(EMOJI_INTENT_REPLIES.get('👍'));
                            done();
                        } catch (err) {
                            reject(err);
                        }
                    });

                    twilioRouter(req, res, next);
                }));
        });

        describe('when the message combines text and an emoji', () => {
            it('should strip the emoji and run item search on the remaining text', () =>
                new Promise((done, reject) => {
                    const body = signedBody({ Body: 'gjallarhorn 🔥' });
                    const req = signedRequest({ body });

                    res.on('end', () => {
                        try {
                            expect(res.statusCode).toEqual(StatusCodes.OK);
                            expect(worldRepository.getItemByName).toHaveBeenCalledWith(
                                'gjallarhorn',
                            );
                            done();
                        } catch (err) {
                            reject(err);
                        }
                    });

                    twilioRouter(req, res, next);
                }));
        });

        describe('when the message has no emoji but multiple internal spaces', () => {
            it('should search with the text unchanged, not collapsing whitespace', () =>
                new Promise((done, reject) => {
                    const body = signedBody({ Body: 'gjallarhorn  rifle' });
                    const req = signedRequest({ body });

                    res.on('end', () => {
                        try {
                            expect(res.statusCode).toEqual(StatusCodes.OK);
                            expect(worldRepository.getItemByName).toHaveBeenCalledWith(
                                'gjallarhorn  rifle',
                            );
                            done();
                        } catch (err) {
                            reject(err);
                        }
                    });

                    twilioRouter(req, res, next);
                }));
        });

        describe('when STOP is sent alongside a trailing emoji', () => {
            it('should still match the STOP keyword after stripping the emoji', () =>
                new Promise((done, reject) => {
                    const body = signedBody({ Body: 'STOP 🛑' });
                    const req = signedRequest({ body });

                    res.on('end', async () => {
                        try {
                            expect(res.statusCode).toEqual(StatusCodes.OK);
                            expect(res._getData()).toContain("You're unsubscribed");
                            await vi.waitFor(() =>
                                expect(userService.updateUserSubscription).toHaveBeenCalledWith(
                                    expect.anything(),
                                    false,
                                ),
                            );
                            expect(consume).not.toHaveBeenCalled();
                            done();
                        } catch (err) {
                            reject(err);
                        }
                    });

                    twilioRouter(req, res, next);
                }));
        });
    });

    describe('POST /destiny/s', () => {
        it('persists callbacks even when inbound ingress capacity is exhausted', async () => {
            ingressConsume.mockRejectedValue(new MockRateLimiterRes());
            const req = signedStatusRequest({
                body: signedStatusBody({ MessageStatus: 'delivered' }),
            });

            await dispatch(twilioRouter, req, res);

            expect(res.statusCode).toBe(StatusCodes.OK);
            expect(callbackConsume).toHaveBeenCalledExactlyOnceWith(req.ip, 1);
            expect(ingressConsume).not.toHaveBeenCalled();
            expect(userService.addUserMessage).toHaveBeenCalledWith(
                expect.objectContaining({ SmsStatus: 'delivered' }),
            );
        });

        it('does not acknowledge callbacks when persistence fails', async () => {
            const error = new Error('persistence unavailable');
            userService.addUserMessage.mockRejectedValueOnce(error);
            const req = signedStatusRequest({
                body: signedStatusBody({ MessageStatus: 'delivered' }),
            });

            await expect(dispatch(twilioRouter, req, res)).rejects.toBe(error);

            expect(res._isEndCalled()).toBe(false);
        });

        it('rejects over-limit callbacks without preventing inbound consent', async () => {
            callbackConsume.mockRejectedValue(
                Object.assign(new MockRateLimiterRes(), { remainingPoints: 0, msBeforeNext: 1000 }),
            );
            const callbackReq = signedStatusRequest({
                body: signedStatusBody({ MessageStatus: 'delivered' }),
            });

            await dispatch(twilioRouter, callbackReq, res);

            expect(res.statusCode).toBe(StatusCodes.TOO_MANY_REQUESTS);
            expect(userService.addUserMessage).not.toHaveBeenCalled();
            expect(ingressConsume).not.toHaveBeenCalled();

            const inboundRes = createResponse({ eventEmitter: EventEmitter });
            const inboundReq = signedRequest({ body: signedBody({ Body: 'STOP' }) });
            await dispatch(twilioRouter, inboundReq, inboundRes);

            expect(inboundRes.statusCode).toBe(StatusCodes.OK);
            expect(inboundRes._getData()).toContain("You're unsubscribed");
            expect(ingressConsume).toHaveBeenCalledExactlyOnceWith(inboundReq.ip, 1);
            expect(callbackConsume).toHaveBeenCalledTimes(1);
        });

        describe('when the signature and schema are valid', () => {
            it('should record the delivery status and reply with empty TwiML', () =>
                new Promise((done, reject) => {
                    userService.getUserByPhoneNumber.mockResolvedValue({
                        dateRegistered: Temporal.Now.instant().toString(),
                        phoneNumber: '+15005550001',
                    });

                    const body = signedStatusBody({ MessageStatus: 'delivered' });
                    const req = signedStatusRequest({ body });

                    res.on('end', () => {
                        try {
                            expect(res.statusCode).toEqual(StatusCodes.OK);
                            expect(userService.getUserByPhoneNumber).toHaveBeenCalledWith(body.To);
                            expect(callbackConsume).toHaveBeenCalledExactlyOnceWith(req.ip, 1);
                            expect(ingressConsume).not.toHaveBeenCalled();
                            expect(consume).not.toHaveBeenCalled();
                            expect(browserConsume).not.toHaveBeenCalled();
                            expect(userService.addUserMessage).toHaveBeenCalledWith(
                                expect.objectContaining({ SmsStatus: 'delivered' }),
                            );
                            done();
                        } catch (err) {
                            reject(err);
                        }
                    });

                    twilioRouter(req, res, next);
                }));
        });

        describe('when the signature is invalid', () => {
            it('should reject the request without recording anything', () =>
                new Promise((done, reject) => {
                    const body = signedStatusBody({ MessageStatus: 'delivered' });
                    const req = signedStatusRequest({ body, signature: 'not-a-valid-signature' });

                    res.on('end', () => {
                        try {
                            expect(res.statusCode).toEqual(StatusCodes.FORBIDDEN);
                            expect(userService.addUserMessage).not.toHaveBeenCalled();
                            done();
                        } catch (err) {
                            reject(err);
                        }
                    });

                    twilioRouter(req, res, next);
                }));
        });

        describe('when the payload has no MessageStatus or SmsStatus', () => {
            it('should reply with empty TwiML without looking up or recording a message', () =>
                new Promise((done, reject) => {
                    const body = signedStatusBody();
                    const req = signedStatusRequest({ body });

                    res.on('end', () => {
                        try {
                            expect(res.statusCode).toEqual(StatusCodes.OK);
                            expect(userService.getUserByPhoneNumber).not.toHaveBeenCalled();
                            expect(userService.addUserMessage).not.toHaveBeenCalled();
                            done();
                        } catch (err) {
                            reject(err);
                        }
                    });

                    twilioRouter(req, res, next);
                }));
        });
    });

    describe.each(['/destiny/r', '/destiny/s', '/destiny/f'])('webhook protection for %s', path => {
        const ingress = {
            '/destiny/r': ingressConsume,
            '/destiny/s': callbackConsume,
            '/destiny/f': fallbackConsume,
        }[path];
        it.each([undefined, null, 'unparsed text', [], { From: { nested: 'value' } }])(
            'returns a private 403 and charges malformed parameters %j to the failure budget',
            async body => {
                const req = createRequest({ method: 'POST', url: path });
                req.body = body;

                await dispatch(twilioRouter, req, res);

                expect(res.statusCode).toBe(StatusCodes.FORBIDDEN);
                expect(ingress).toHaveBeenCalledExactlyOnceWith(req.ip, 1);
                expect(invalidConsume).toHaveBeenCalledExactlyOnceWith(req.ip, 1);
                expect(res._getData()).toBe('');
                for (const header of [
                    'X-RateLimit-Limit',
                    'X-RateLimit-Remaining',
                    'X-RateLimit-Reset',
                    'Retry-After',
                ]) {
                    expect(res.getHeader(header)).toBeUndefined();
                }
                expect(consume).not.toHaveBeenCalled();
                expect(userService.getUserByPhoneNumber).not.toHaveBeenCalled();
                expect(authenticationService.authenticate).not.toHaveBeenCalled();
            },
        );

        it.each([undefined, ['signature'], 'invalid', `${'A'.repeat(27)}=`])(
            'rejects signature %j without revealing the failure budget',
            async signature => {
                invalidConsume.mockRejectedValueOnce(new MockRateLimiterRes());
                const req = createRequest({
                    method: 'POST',
                    url: path,
                    originalUrl: `/twilio${path}`,
                    body: signedBody(),
                    headers: { 'x-twilio-signature': signature },
                });

                await dispatch(twilioRouter, req, res);

                expect(res.statusCode).toBe(StatusCodes.FORBIDDEN);
                expect(res._getData()).toBe('');
                expect(invalidConsume).toHaveBeenCalledExactlyOnceWith(req.ip, 1);
                expect(res.getHeader('X-RateLimit-Remaining')).toBeUndefined();
                expect(userService.getUserByPhoneNumber).not.toHaveBeenCalled();
                expect(userService.addUserMessage).not.toHaveBeenCalled();
            },
        );

        it('throttles unsigned traffic before signature validation', async () => {
            ingress.mockRejectedValueOnce(
                Object.assign(new MockRateLimiterRes(), {
                    remainingPoints: 0,
                    msBeforeNext: 1000,
                }),
            );
            const req = createRequest({ method: 'POST', url: path, body: {} });

            await dispatch(twilioRouter, req, res);

            expect(res.statusCode).toBe(StatusCodes.TOO_MANY_REQUESTS);
            expect(res.getHeader('X-RateLimit-Limit')).toBe(1000);
            expect(consume).not.toHaveBeenCalled();
            expect(userService.getUserByPhoneNumber).not.toHaveBeenCalled();
        });
    });

    it.each([
        ['POST', '/twilio/unknown'],
        ['GET', '/twilio/destiny/r'],
        ['GET', '/twilio/destiny/s'],
    ])(
        'terminates unmatched %s %s after preflight without charging the browser bucket',
        async (method, url) => {
            const router = Router();
            router.use('/twilio', twilioPreflightMiddleware, twilioRouter);
            router.use(rateLimiterMiddleware);
            const req = createRequest({
                method,
                url,
                headers: { 'x-twilio-signature': 'non-empty' },
            });

            await dispatch(router, req, res);

            expect(res.statusCode).toBe(StatusCodes.NOT_FOUND);
            expect(ingressConsume).toHaveBeenCalledExactlyOnceWith(req.ip, 1);
            expect(browserConsume).not.toHaveBeenCalled();
            expect(callbackConsume).not.toHaveBeenCalled();
            expect(consume).not.toHaveBeenCalled();
        },
    );

    it('rejects an unsigned unmatched path at preflight before the 404 handler', async () => {
        const router = Router();
        router.use('/twilio', twilioPreflightMiddleware, twilioRouter);
        router.use(rateLimiterMiddleware);
        const req = createRequest({ method: 'POST', url: '/twilio/unknown' });

        await dispatch(router, req, res);

        expect(res.statusCode).toBe(StatusCodes.FORBIDDEN);
        expect(invalidConsume).toHaveBeenCalledExactlyOnceWith(req.ip, 1);
        expect(ingressConsume).not.toHaveBeenCalled();
        expect(browserConsume).not.toHaveBeenCalled();
    });

    describe('POST /destiny/f', () => {
        it('serves fallback without consuming the exhausted inbound bucket', async () => {
            ingressConsume.mockRejectedValue(new MockRateLimiterRes());
            const req = signedRequest({
                body: signedBody({ ErrorCode: '11200', ErrorUrl: getUrl() }),
                path: '/destiny/f',
            });

            await dispatch(twilioRouter, req, res);

            expect(res.statusCode).toBe(StatusCodes.OK);
            expect(res._getData()).toContain('Destiny-Ghost: ');
            expect(fallbackConsume).toHaveBeenCalledExactlyOnceWith(req.ip, 1);
            expect(ingressConsume).not.toHaveBeenCalled();
            expect(callbackConsume).not.toHaveBeenCalled();
        });

        it('should reply with a branded fallback message', () =>
            new Promise((done, reject) => {
                const req = signedRequest({ body: signedBody(), path: '/destiny/f' });

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

                    const req = signedRequest({ body: signedBody(), path: '/destiny/f' });

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
