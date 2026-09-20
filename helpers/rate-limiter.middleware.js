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
/**
 * Inbound SMS used to ride the browser bucket by way of a session the Twilio
 * webhook bootstrapped for itself. Now that webhooks never touch the session,
 * senders get their own bucket keyed on the phone number Twilio signed for.
 */
const twilioSenderLimiter = new RateLimiterRedis({
    storeClient: client,
    keyPrefix: 'twilio-sender',
    points: 20,
    duration: 60,
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

export default rateLimiterMiddleware;
export { twilioRateLimiterMiddleware };
