// @ts-check
import { StatusCodes } from 'http-status-codes';
import { RateLimiterRedis, RateLimiterRes } from 'rate-limiter-flexible';
import client from './cache.js';

const options = {
    storeClient: client,
    keyPrefix: 'austringer',
    points: 100, // 100 requests
    duration: 1, // per 1 second
};
const rateLimiter = new RateLimiterRedis(options);
const twilioIngressLimiter = new RateLimiterRedis({
    storeClient: client,
    keyPrefix: 'twilio-ingress',
    points: 1000,
    duration: 1,
});
const twilioSenderLimiter = new RateLimiterRedis({
    storeClient: client,
    keyPrefix: 'twilio-sender',
    points: 20,
    duration: 60,
});
const twilioCallbackLimiter = new RateLimiterRedis({
    storeClient: client,
    keyPrefix: 'twilio-callback',
    points: 1000,
    duration: 1,
});
const twilioFallbackLimiter = new RateLimiterRedis({
    storeClient: client,
    keyPrefix: 'twilio-fallback',
    points: 1000,
    duration: 1,
});
const twilioInvalidLimiter = new RateLimiterRedis({
    storeClient: client,
    keyPrefix: 'twilio-invalid',
    points: 10,
    duration: 1,
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

export default rateLimiterMiddleware;
export {
    twilioRateLimiterMiddleware,
    twilioIngressRateLimiterMiddleware,
    twilioCallbackRateLimiterMiddleware,
    twilioFallbackRateLimiterMiddleware,
    twilioPreflightMiddleware,
    rejectTwilioRequest,
};
