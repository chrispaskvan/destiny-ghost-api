const HttpStatus = require('http-status-codes');
const { RateLimiterRedis } = require('rate-limiter-flexible');
const client = require('./cache');

const options = {
    redis: client,
    keyPrefix: 'middleware',
    points: 100, // 100 requests
    duration: 1, // per 1 second
};
const rateLimiter = new RateLimiterRedis(options);

function setRateLimitHeaders(rateLimiterRes, res) {
    const headers = {
        'X-RateLimit-Limit': options.points,
        'X-RateLimit-Remaining': rateLimiterRes.remainingPoints,
        'X-RateLimit-Reset': new Date(Date.now() + rateLimiterRes.msBeforeNext),
    };

    res.set(headers);
}

const rateLimiterMiddleware = (req, res, next) => {
    const { ip, session: { membershipId, dateRegistered } = {} } = req;
    const key = membershipId || ip;
    const pointsToConsume = dateRegistered ? 1 : 10;

    rateLimiter.consume(key, pointsToConsume)
        .then(rateLimiterRes => {
            setRateLimitHeaders(rateLimiterRes, res);
            next();
        })
        .catch(rateLimiterRes => {
            setRateLimitHeaders(rateLimiterRes, res);
            res.status(HttpStatus.StatusCodes.TOO_MANY_REQUESTS).end();
        });
};

module.exports = rateLimiterMiddleware;
