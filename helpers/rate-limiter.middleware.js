// @ts-check
import { StatusCodes } from 'http-status-codes';
import { RateLimiterRedis, RateLimiterRes } from 'rate-limiter-flexible';
import client from './cache.js';
import TOKEN_TTL_SECONDS from '../users/token-ttl.js';

// rate-limiter-flexible picks its node-redis code path by the client's class name (`Commander`),
// which node-redis v6 no longer uses. Without `useRedisPackage` every consume throws, and
// consumePoints below fails open on that error, so no limit is ever enforced.
const store = { storeClient: client, useRedisPackage: true };
const options = {
    ...store,
    keyPrefix: 'austringer',
    points: 100, // 100 requests
    duration: 1, // per 1 second
};
const rateLimiter = new RateLimiterRedis(options);
const twilioIngressLimiter = new RateLimiterRedis({
    ...store,
    keyPrefix: 'twilio-ingress',
    points: 1000,
    duration: 1,
});
const twilioSenderLimiter = new RateLimiterRedis({
    ...store,
    keyPrefix: 'twilio-sender',
    points: 20,
    duration: 60,
});
const twilioCallbackLimiter = new RateLimiterRedis({
    ...store,
    keyPrefix: 'twilio-callback',
    points: 1000,
    duration: 1,
});
const twilioFallbackLimiter = new RateLimiterRedis({
    ...store,
    keyPrefix: 'twilio-fallback',
    points: 1000,
    duration: 1,
});
const twilioInvalidLimiter = new RateLimiterRedis({
    ...store,
    keyPrefix: 'twilio-invalid',
    points: 10,
    duration: 1,
});
/**
 * Each sign-up and resend sends a billed SMS and/or email, and the global
 * bucket alone let a session send about ten a second (#571).
 */
const signUpLimiter = new RateLimiterRedis({
    ...store,
    keyPrefix: 'sign-up',
    points: 5,
    duration: 60 * 60,
});
const resendLimiter = new RateLimiterRedis({
    ...store,
    keyPrefix: 'sign-up-resend',
    points: 3,
    duration: 15 * 60,
});
/** A registered account's re-verification codes, billed the same way. */
const cipherLimiter = new RateLimiterRedis({
    ...store,
    keyPrefix: 'cipher',
    points: 3,
    duration: 15 * 60,
});
/**
 * Attempts per verification code. A 6-digit code at the global limit had
 * about a 1% chance of being guessed within one TTL.
 *
 * The count lasts as long as a token does. It starts at a code's first
 * attempt, never before the code was minted, so it always outlasts the code
 * and a spent code can't get its attempts back. The key names the token, so
 * a new code starts afresh.
 */
const cipherAttemptLimiter = new RateLimiterRedis({
    ...store,
    keyPrefix: 'cipher-attempt',
    points: 5,
    duration: TOKEN_TTL_SECONDS,
});

/**
 * @param {import('rate-limiter-flexible').RateLimiterRes} rateLimiterRes
 * @param {import('express').Response} res
 * @param {number} limit
 */
function setRateLimitHeaders(rateLimiterRes, res, limit) {
    const headers = {
        'X-RateLimit-Limit': limit,
        'X-RateLimit-Remaining': rateLimiterRes.remainingPoints,
        'X-RateLimit-Reset': Math.ceil(
            Temporal.Now.instant().add({ milliseconds: rateLimiterRes.msBeforeNext })
                .epochMilliseconds / 1000,
        ),
    };

    res.set(headers);
}

/**
 * @param {RateLimiterRedis} limiter
 * @param {string} key
 * @param {number} pointsToConsume
 * @param {import('express').Response} res
 * @param {import('express').NextFunction} next
 * @param {() => void} [onLimit]
 */
const consumePoints = (limiter, key, pointsToConsume, res, next, onLimit) => {
    if (!client.isReady) {
        next();
        return Promise.resolve();
    }

    return limiter
        .consume(key, pointsToConsume)
        .then(rateLimiterRes => {
            setRateLimitHeaders(rateLimiterRes, res, limiter.points);
            next();
        })
        .catch(rejection => {
            // `consume()` rejects with a `RateLimiterRes` when the limit is
            // actually exceeded, but can also reject with a plain `Error`
            // when the underlying Redis command itself fails (independent
            // of `client.isReady`, which only reflects connection-handshake
            // state, not per-command success). Only a genuine
            // `RateLimiterRes` rejection should ever produce a 429; any
            // other rejection - including a not-ready client - fails open.
            //
            // Separately: node-redis' client has no `.status` property
            // (that's an ioredis-only API) - checking it always read
            // `undefined`, so the rate limiter never actually enforced a
            // 429; every rejection fell through to `next()`. `isReady` is
            // node-redis' real connection-state flag.
            if (rejection instanceof RateLimiterRes && client.isReady) {
                setRateLimitHeaders(rejection, res, limiter.points);
                if (onLimit) {
                    onLimit();
                    return;
                }
                res.set('Retry-After', String(Math.ceil(rejection.msBeforeNext / 1000)));
                res.status(StatusCodes.TOO_MANY_REQUESTS).end();
            } else {
                next();
            }
        });
};

/**
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 * @param {import('express').NextFunction} next
 */
const rateLimiterMiddleware = (req, res, next) => {
    const { membershipId, dateRegistered } =
        /** @type {import('../users/user.routes.js').AppSessionData} */ (
            /** @type {unknown} */ (req.session)
        ) ?? {};

    /**
     * Twilio traffic never reaches this bucket: `/twilio` mounts ahead of it
     * in loaders/routes.js and terminates in the router's own 404, so inbound
     * webhooks are charged to the dedicated ingress, callback and fallback
     * budgets instead. The point discount this bucket carried for them is
     * gone with it.
     */
    return consumePoints(
        rateLimiter,
        /** @type {string} */ (membershipId || req.ip),
        dateRegistered ? 1 : 10,
        res,
        next,
    );
};

/**
 * Rate limit a sender only after Twilio signature and payload validation.
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 * @param {import('express').NextFunction} next
 * @param {() => void} onLimit
 */
const twilioRateLimiterMiddleware = (req, res, next, onLimit) =>
    consumePoints(twilioSenderLimiter, req.body.From, 1, res, next, onLimit);

/**
 * Protect inbound and unmatched Twilio requests.
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 * @param {import('express').NextFunction} next
 */
const twilioIngressRateLimiterMiddleware = (req, res, next) =>
    consumePoints(twilioIngressLimiter, /** @type {string} */ (req.ip), 1, res, next);

/**
 * Protect delivery callbacks independently of inbound message capacity.
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 * @param {import('express').NextFunction} next
 */
const twilioCallbackRateLimiterMiddleware = (req, res, next) =>
    consumePoints(twilioCallbackLimiter, /** @type {string} */ (req.ip), 1, res, next);

/**
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 * @param {import('express').NextFunction} next
 */
const twilioFallbackRateLimiterMiddleware = (req, res, next) =>
    consumePoints(twilioFallbackLimiter, /** @type {string} */ (req.ip), 1, res, next);

/**
 * @param {import('express').Response} res
 */
const forbiddenTwilioResponse = res => {
    for (const header of [
        'X-RateLimit-Limit',
        'X-RateLimit-Remaining',
        'X-RateLimit-Reset',
        'Retry-After',
    ]) {
        res.removeHeader(header);
    }
    return res.status(StatusCodes.FORBIDDEN).end();
};

/**
 * Record failed verification without charging legitimate webhook traffic.
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 */
const rejectTwilioRequest = async (req, res) => {
    if (client.isReady) {
        await twilioInvalidLimiter
            .consume(/** @type {string} */ (req.ip), 1)
            .catch(() => undefined);
    }
    return forbiddenTwilioResponse(res);
};

/**
 * Reject repeat failed verification and missing signatures before parsing bodies.
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 * @param {import('express').NextFunction} next
 */
const twilioPreflightMiddleware = async (req, res, next) => {
    const signature = req.headers['x-twilio-signature'];

    if (typeof signature !== 'string' || !signature.trim()) {
        return rejectTwilioRequest(req, res);
    }

    if (!client.isReady) {
        return next();
    }

    let result;
    try {
        result = await twilioInvalidLimiter.get(/** @type {string} */ (req.ip));
    } catch {
        return next();
    }

    if (result && result.consumedPoints >= twilioInvalidLimiter.points && client.isReady) {
        return forbiddenTwilioResponse(res);
    }

    return next();
};

/**
 * The account a per-account limit charges: the session's `membershipType`
 * and `displayName`, which `authenticateUser` requires. Not `membershipId`,
 * which older records without Bungie data leave undefined, so they would all
 * share one bucket.
 * @param {import('express').Request} req
 * @returns {string}
 */
const accountKey = req => {
    const { displayName, membershipType } =
        /** @type {import('../users/user.routes.js').AppSessionData} */ (
            /** @type {unknown} */ (req.session)
        );

    return `${membershipType}:${displayName}`;
};

/**
 * Limit sign-ups per account. Runs after `authenticateUser`, so the session
 * names an account.
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 * @param {import('express').NextFunction} next
 */
const signUpRateLimiterMiddleware = (req, res, next) =>
    consumePoints(signUpLimiter, accountKey(req), 1, res, next);

/**
 * Charge a request to its account and channel. Runs after the route has
 * checked the channel.
 * @param {RateLimiterRedis} limiter
 * @returns {import('express').RequestHandler}
 */
const perChannel = limiter => (req, res, next) =>
    consumePoints(limiter, `${accountKey(req)}:${req.body.channel}`, 1, res, next);

/** Limit sign-up resends per account and channel. */
const resendRateLimiterMiddleware = perChannel(resendLimiter);

/** Limit re-verification codes per account and channel. */
const cipherRateLimiterMiddleware = perChannel(cipherLimiter);

/**
 * Spend one of a verification code's attempts. Consumed before the code is
 * compared, so parallel guesses can't all slip past a check that only
 * recorded failures afterwards.
 *
 * Fails open, like every bucket here. When the client isn't ready, sessions
 * (`helpers/store.js`, the same client) fail too, so the request never
 * authenticates. A single command failing on a connected client lets that
 * attempt through with no limit at all, since the global bucket fails open
 * the same way.
 * @param {string} key - names the token being tried
 * @returns {Promise<boolean>} false once the code's attempts are spent
 */
const allowCipherAttempt = async key => {
    if (!client.isReady) {
        return true;
    }

    try {
        await cipherAttemptLimiter.consume(key, 1);

        return true;
    } catch (rejection) {
        return !(rejection instanceof RateLimiterRes && client.isReady);
    }
};

export default rateLimiterMiddleware;
export {
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
};
