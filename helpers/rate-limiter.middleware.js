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
 * @param {import('rate-limiter-flexible').RateLimiterRes} rateLimiterRes
 * @param {import('express').Response} res
 */
function setRateLimitHeaders(rateLimiterRes, res) {
    const headers = {
        'X-RateLimit-Limit': options.points,
        'X-RateLimit-Remaining': rateLimiterRes.remainingPoints,
        'X-RateLimit-Reset': Math.ceil(
            Temporal.Now.instant().add({ milliseconds: rateLimiterRes.msBeforeNext })
                .epochMilliseconds / 1000,
        ),
    };

    res.set(headers);
}

/**
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 * @param {import('express').NextFunction} next
 */
const rateLimiterMiddleware = (req, res, next) => {
    const { ip } = req;
    const { membershipId, dateRegistered } =
        /** @type {import('../users/user.routes.js').AppSessionData} */ (
            /** @type {unknown} */ (req.session)
        ) ?? {};
    const key = membershipId || ip;
    const pointsToConsume = dateRegistered ? 1 : 10;

    rateLimiter
        .consume(/** @type {string} */ (key), pointsToConsume)
        .then(rateLimiterRes => {
            setRateLimitHeaders(rateLimiterRes, res);
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
                setRateLimitHeaders(rejection, res);
                res.status(StatusCodes.TOO_MANY_REQUESTS).end();
            } else {
                next();
            }
        });
};

export default rateLimiterMiddleware;
