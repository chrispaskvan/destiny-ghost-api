import { describe, it, expect, vi, beforeEach } from 'vitest';
import { StatusCodes } from 'http-status-codes';

const {
    consume,
    ingressConsume,
    senderConsume,
    callbackConsume,
    fallbackConsume,
    invalidConsume,
    invalidGet,
    signUpConsume,
    resendConsume,
    cipherConsume,
    cipherAttemptConsume,
    MockRateLimiterRes,
    limiterOptions,
} = vi.hoisted(() => ({
    // Recorded at import time; `clearMocks` would wipe the calls of a vi.fn() constructor.
    limiterOptions: [],
    consume: vi.fn(),
    ingressConsume: vi.fn(),
    senderConsume: vi.fn(),
    callbackConsume: vi.fn(),
    fallbackConsume: vi.fn(),
    invalidConsume: vi.fn(),
    invalidGet: vi.fn(),
    signUpConsume: vi.fn(),
    resendConsume: vi.fn(),
    cipherConsume: vi.fn(),
    cipherAttemptConsume: vi.fn(),
    MockRateLimiterRes: class RateLimiterRes {
        constructor(remainingPoints, msBeforeNext) {
            this.remainingPoints = remainingPoints;
            this.msBeforeNext = msBeforeNext;
        }
    },
}));

vi.mock('rate-limiter-flexible', () => ({
    RateLimiterRedis: class {
        constructor(options) {
            const { points, keyPrefix } = options;
            limiterOptions.push(options);
            this.points = points;
            this.consume = {
                austringer: consume,
                'twilio-ingress': ingressConsume,
                'twilio-sender': senderConsume,
                'twilio-callback': callbackConsume,
                'twilio-fallback': fallbackConsume,
                'twilio-invalid': invalidConsume,
                'sign-up': signUpConsume,
                'sign-up-resend': resendConsume,
                cipher: cipherConsume,
                'cipher-attempt': cipherAttemptConsume,
            }[keyPrefix];
            this.get = invalidGet;
        }
    },
    RateLimiterRes: MockRateLimiterRes,
}));
vi.mock('./cache.js', () => ({
    default: { isReady: true },
}));

import cache from './cache.js';
import rateLimiterMiddleware, {
    twilioRateLimiterMiddleware,
    twilioIngressRateLimiterMiddleware,
    twilioCallbackRateLimiterMiddleware,
    twilioFallbackRateLimiterMiddleware,
    twilioPreflightMiddleware,
    rejectTwilioRequest,
    signUpRateLimiterMiddleware,
    resendRateLimiterMiddleware,
    cipherRateLimiterMiddleware,
    allowCipherAttempt,
} from './rate-limiter.middleware.js';

describe('rate limiter store', () => {
    it('keeps every bucket on the cache client, through the node-redis code path', () => {
        expect(limiterOptions.map(({ keyPrefix }) => keyPrefix)).toEqual([
            'austringer',
            'twilio-ingress',
            'twilio-sender',
            'twilio-callback',
            'twilio-fallback',
            'twilio-invalid',
            'sign-up',
            'sign-up-resend',
            'cipher',
            'cipher-attempt',
        ]);
        for (const options of limiterOptions) {
            expect(options).toMatchObject({ storeClient: cache, useRedisPackage: true });
        }
    });
});

describe('verification limits', () => {
    const limits = prefix => limiterOptions.find(({ keyPrefix }) => keyPrefix === prefix);
    let req, res, next;

    beforeEach(() => {
        vi.clearAllMocks();
        cache.isReady = true;
        req = { ip: '127.0.0.1', session: { membershipId: 'm-1' }, body: {}, headers: {} };
        res = { set: vi.fn(), status: vi.fn().mockReturnThis(), end: vi.fn() };
        next = vi.fn();
    });

    it('allows 5 sign-ups an hour, 3 resends per channel per 15 minutes, 5 attempts per code', () => {
        expect(limits('sign-up')).toMatchObject({ points: 5, duration: 60 * 60 });
        expect(limits('sign-up-resend')).toMatchObject({ points: 3, duration: 15 * 60 });
        expect(limits('cipher')).toMatchObject({ points: 3, duration: 15 * 60 });
        /** Longer than any token lives, so a code's count outlasts it. */
        expect(limits('cipher-attempt')).toMatchObject({ points: 5, duration: 24 * 60 * 60 });
    });

    it('charges a sign-up to the session membership', async () => {
        signUpConsume.mockResolvedValueOnce({ remainingPoints: 4, msBeforeNext: 1000 });

        await signUpRateLimiterMiddleware(req, res, next);

        expect(signUpConsume).toHaveBeenCalledExactlyOnceWith('m-1', 1);
        expect(next).toHaveBeenCalledExactlyOnceWith();
    });

    it('charges a resend to the session membership and channel', async () => {
        req.body.channel = 'phone';
        resendConsume.mockResolvedValueOnce({ remainingPoints: 2, msBeforeNext: 1000 });

        await resendRateLimiterMiddleware(req, res, next);

        expect(resendConsume).toHaveBeenCalledExactlyOnceWith('m-1:phone', 1);
        expect(next).toHaveBeenCalledExactlyOnceWith();
    });

    it('charges a cipher to the session membership and channel, apart from resends', async () => {
        req.body.channel = 'email';
        cipherConsume.mockResolvedValueOnce({ remainingPoints: 2, msBeforeNext: 1000 });

        await cipherRateLimiterMiddleware(req, res, next);

        expect(cipherConsume).toHaveBeenCalledExactlyOnceWith('m-1:email', 1);
        expect(resendConsume).not.toHaveBeenCalled();
        expect(next).toHaveBeenCalledExactlyOnceWith();
    });

    it('answers 429 with Retry-After once resends run out', async () => {
        req.body.channel = 'email';
        resendConsume.mockRejectedValueOnce(new MockRateLimiterRes(0, 61_000));

        await resendRateLimiterMiddleware(req, res, next);

        expect(res.set).toHaveBeenCalledWith('Retry-After', '61');
        expect(res.status).toHaveBeenCalledWith(StatusCodes.TOO_MANY_REQUESTS);
        expect(next).not.toHaveBeenCalled();
    });

    describe('allowCipherAttempt', () => {
        it('allows an attempt while the code has points left', async () => {
            cipherAttemptConsume.mockResolvedValueOnce({ remainingPoints: 4 });

            await expect(allowCipherAttempt('key')).resolves.toBe(true);
            expect(cipherAttemptConsume).toHaveBeenCalledExactlyOnceWith('key', 1);
        });

        it('refuses an attempt once the code has none', async () => {
            cipherAttemptConsume.mockRejectedValueOnce(new MockRateLimiterRes(0, 1000));

            await expect(allowCipherAttempt('key')).resolves.toBe(false);
        });

        it('fails open when Redis errors', async () => {
            cipherAttemptConsume.mockRejectedValueOnce(new Error('Redis unavailable'));

            await expect(allowCipherAttempt('key')).resolves.toBe(true);
        });

        it('fails open when Redis is not ready', async () => {
            cache.isReady = false;

            await expect(allowCipherAttempt('key')).resolves.toBe(true);
            expect(cipherAttemptConsume).not.toHaveBeenCalled();
        });
    });
});

describe('rateLimiterMiddleware', () => {
    let req, res, next;

    beforeEach(() => {
        vi.clearAllMocks();
        cache.isReady = true;
        req = { ip: '127.0.0.1', session: {}, headers: {} };
        invalidGet.mockReset().mockResolvedValue(null);
        invalidConsume.mockReset().mockResolvedValue({ remainingPoints: 9, msBeforeNext: 1000 });
        res = {
            set: vi.fn(),
            removeHeader: vi.fn(),
            status: vi.fn().mockReturnThis(),
            end: vi.fn(),
        };
        next = vi.fn();
    });

    it.each([
        ['POST', '/users'],
        ['GET', '/destiny2'],
    ])('keeps the global IP limit for %s %s', async (method, path) => {
        Object.assign(req, { method, path });
        consume.mockResolvedValue({ remainingPoints: 90, msBeforeNext: 1000 });

        await rateLimiterMiddleware(req, res, next);

        expect(consume).toHaveBeenCalledExactlyOnceWith(req.ip, 10);
    });

    it.each([undefined, '', '   ', ['signature']])(
        'rejects a missing or empty signature %j without parsing a body',
        async signature => {
            req.headers['x-twilio-signature'] = signature;

            await twilioPreflightMiddleware(req, res, next);

            expect(invalidConsume).toHaveBeenCalledExactlyOnceWith(req.ip, 1);
            expect(res.status).toHaveBeenCalledWith(StatusCodes.FORBIDDEN);
            expect(next).not.toHaveBeenCalled();
        },
    );

    it('blocks repeat invalid signatures before body parsing', async () => {
        req.headers['x-twilio-signature'] = `${'A'.repeat(27)}=`;
        invalidGet.mockResolvedValueOnce({
            consumedPoints: 10,
            remainingPoints: 0,
            msBeforeNext: 500,
        });

        await twilioPreflightMiddleware(req, res, next);

        expect(invalidGet).toHaveBeenCalledExactlyOnceWith(req.ip);
        expect(res.status).toHaveBeenCalledWith(StatusCodes.FORBIDDEN);
        expect(res.set).not.toHaveBeenCalled();
        expect(next).not.toHaveBeenCalled();
        expect(invalidConsume).not.toHaveBeenCalled();
    });

    it.each(['invalid', 'future/signature+format', `${'A'.repeat(27)}=`])(
        'defers a non-empty signature %s to SDK verification without charging the failure budget',
        async signature => {
            req.headers['x-twilio-signature'] = signature;

            await twilioPreflightMiddleware(req, res, next);

            expect(next).toHaveBeenCalledExactlyOnceWith();
            expect(invalidConsume).not.toHaveBeenCalled();
        },
    );

    it('fails open for Redis errors but still rejects failed signature verification', async () => {
        req.headers['x-twilio-signature'] = `${'A'.repeat(27)}=`;
        invalidGet.mockRejectedValueOnce(new Error('Redis unavailable'));
        invalidConsume.mockRejectedValueOnce(new Error('Redis unavailable'));

        await twilioPreflightMiddleware(req, res, next);
        expect(next).toHaveBeenCalledExactlyOnceWith();

        await rejectTwilioRequest(req, res);
        expect(res.status).toHaveBeenCalledWith(StatusCodes.FORBIDDEN);
    });

    it.each(['under limit', 'over limit', 'backend failure', 'disconnected'])(
        'keeps authentication failures private and forbidden when %s',
        async state => {
            if (state === 'over limit')
                invalidConsume.mockRejectedValueOnce(new MockRateLimiterRes(0, 1000));
            if (state === 'backend failure')
                invalidConsume.mockRejectedValueOnce(new Error('Redis unavailable'));
            if (state === 'disconnected') cache.isReady = false;

            await rejectTwilioRequest(req, res);

            if (state === 'disconnected') {
                expect(invalidConsume).not.toHaveBeenCalled();
            } else {
                expect(invalidConsume).toHaveBeenCalledExactlyOnceWith(req.ip, 1);
            }
            expect(res.status).toHaveBeenCalledExactlyOnceWith(StatusCodes.FORBIDDEN);
            expect(res.set).not.toHaveBeenCalled();
            for (const header of [
                'X-RateLimit-Limit',
                'X-RateLimit-Remaining',
                'X-RateLimit-Reset',
                'Retry-After',
            ]) {
                expect(res.removeHeader).toHaveBeenCalledWith(header);
            }
            expect(ingressConsume).not.toHaveBeenCalled();
            expect(consume).not.toHaveBeenCalled();
        },
    );

    it('isolates fallback capacity from inbound and callback traffic', async () => {
        fallbackConsume.mockResolvedValueOnce({ remainingPoints: 999, msBeforeNext: 1000 });

        await twilioFallbackRateLimiterMiddleware(req, res, next);

        expect(fallbackConsume).toHaveBeenCalledExactlyOnceWith(req.ip, 1);
        expect(ingressConsume).not.toHaveBeenCalled();
        expect(callbackConsume).not.toHaveBeenCalled();
        expect(next).toHaveBeenCalledExactlyOnceWith();
    });

    it('preserves the registered browser membership bucket', async () => {
        req.session = { membershipId: 'member-id', dateRegistered: '2026-09-19' };
        consume.mockResolvedValue({ remainingPoints: 99, msBeforeNext: 1000 });

        await rateLimiterMiddleware(req, res, next);

        expect(consume).toHaveBeenCalledExactlyOnceWith('member-id', 1);
    });

    it('isolates signed senders sharing an IP and reuses a repeat sender bucket', async () => {
        senderConsume.mockResolvedValue({ remainingPoints: 19, msBeforeNext: 60000 });
        req.session = { membershipId: 'browser-member' };

        for (const sender of ['+15005550006', '+15005550007', '+15005550006']) {
            req.body = { From: sender };
            await twilioRateLimiterMiddleware(req, res, next);
        }

        expect(senderConsume.mock.calls).toEqual([
            ['+15005550006', 1],
            ['+15005550007', 1],
            ['+15005550006', 1],
        ]);
        expect(res.set).toHaveBeenCalledWith(expect.objectContaining({ 'X-RateLimit-Limit': 20 }));
        expect(consume).not.toHaveBeenCalled();
        expect(req.session).toEqual({ membershipId: 'browser-member' });
    });

    it('uses a separate ingress IP budget independent of sender and browser identity', async () => {
        ingressConsume.mockResolvedValue({ remainingPoints: 999, msBeforeNext: 1000 });
        req.session = { membershipId: 'browser-member', dateRegistered: '2026-09-19' };
        req.body = { From: 'untrusted-sender' };

        await twilioIngressRateLimiterMiddleware(req, res, next);

        expect(ingressConsume).toHaveBeenCalledExactlyOnceWith(req.ip, 1);
        expect(senderConsume).not.toHaveBeenCalled();
        expect(consume).not.toHaveBeenCalled();
        expect(res.set).toHaveBeenCalledWith(
            expect.objectContaining({ 'X-RateLimit-Limit': 1000 }),
        );
    });

    it('delegates an exhausted sender quota to its webhook response policy', async () => {
        senderConsume.mockRejectedValueOnce(new MockRateLimiterRes(0, 59001));
        req.body = { From: '+15005550006' };
        const onLimit = vi.fn();

        await twilioRateLimiterMiddleware(req, res, next, onLimit);

        expect(onLimit).toHaveBeenCalledExactlyOnceWith();
        expect(res.status).not.toHaveBeenCalled();
        expect(res.set).not.toHaveBeenCalledWith('Retry-After', expect.anything());
        expect(res.set).toHaveBeenCalledWith(expect.objectContaining({ 'X-RateLimit-Limit': 20 }));
        expect(next).not.toHaveBeenCalled();
    });

    it('uses an independent callback budget for the same ingress IP', async () => {
        callbackConsume.mockResolvedValueOnce({ remainingPoints: 999, msBeforeNext: 1000 });

        await twilioCallbackRateLimiterMiddleware(req, res, next);

        expect(callbackConsume).toHaveBeenCalledExactlyOnceWith(req.ip, 1);
        expect(ingressConsume).not.toHaveBeenCalled();
        expect(senderConsume).not.toHaveBeenCalled();
        expect(consume).not.toHaveBeenCalled();
        expect(next).toHaveBeenCalledExactlyOnceWith();
    });

    it('rejects exhausted callback capacity without acknowledging the event', async () => {
        callbackConsume.mockRejectedValueOnce(new MockRateLimiterRes(0, 1000));

        await twilioCallbackRateLimiterMiddleware(req, res, next);

        expect(res.status).toHaveBeenCalledWith(StatusCodes.TOO_MANY_REQUESTS);
        expect(res.set).toHaveBeenCalledWith('Retry-After', '1');
        expect(next).not.toHaveBeenCalled();
    });

    it('should call next and set rate-limit headers when under the limit', async () => {
        consume.mockResolvedValue({ remainingPoints: 99, msBeforeNext: 1000 });

        rateLimiterMiddleware(req, res, next);
        await new Promise(resolve => setImmediate(resolve));

        expect(res.set).toHaveBeenCalledWith(
            expect.objectContaining({ 'X-RateLimit-Remaining': 99 }),
        );
        expect(next).toHaveBeenCalled();
        expect(res.status).not.toHaveBeenCalled();
    });

    it('should respond 429 when the limit is exceeded and Redis is ready', async () => {
        consume.mockRejectedValue(new MockRateLimiterRes(0, 1000));
        cache.isReady = true;

        rateLimiterMiddleware(req, res, next);
        await new Promise(resolve => setImmediate(resolve));

        expect(res.status).toHaveBeenCalledWith(StatusCodes.TOO_MANY_REQUESTS);
        expect(res.end).toHaveBeenCalled();
        expect(next).not.toHaveBeenCalled();
    });

    it('should fail open and call next when Redis is not ready', async () => {
        consume.mockRejectedValue(new MockRateLimiterRes(0, 1000));
        cache.isReady = false;

        rateLimiterMiddleware(req, res, next);
        await new Promise(resolve => setImmediate(resolve));

        expect(next).toHaveBeenCalled();
        expect(res.status).not.toHaveBeenCalled();
        expect(consume).not.toHaveBeenCalled();
    });

    it('does not queue a preflight Redis read while disconnected', async () => {
        cache.isReady = false;
        req.headers['x-twilio-signature'] = `${'A'.repeat(27)}=`;

        await twilioPreflightMiddleware(req, res, next);

        expect(next).toHaveBeenCalledExactlyOnceWith();
        expect(invalidGet).not.toHaveBeenCalled();
        expect(invalidConsume).not.toHaveBeenCalled();
    });

    it('should fail open and call next when the backend rejects with a plain Error while Redis is ready', async () => {
        consume.mockRejectedValue(new Error('connection lost'));
        cache.isReady = true;

        rateLimiterMiddleware(req, res, next);
        await new Promise(resolve => setImmediate(resolve));

        expect(next).toHaveBeenCalled();
        expect(res.status).not.toHaveBeenCalled();
        expect(res.set).not.toHaveBeenCalled();
    });
});
