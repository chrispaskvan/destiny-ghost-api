// @ts-check
import { RateLimiterRes } from 'rate-limiter-flexible';

/**
 * Spend a point.
 * @param {import('rate-limiter-flexible').RateLimiterRedis} limiter
 * @param {string} key
 * @returns {Promise<boolean>} false once the limit is spent
 * @throws when Redis can't answer
 */
const spendPoint = async (limiter, key) => {
    try {
        await limiter.consume(key);

        return true;
    } catch (rejection) {
        if (rejection instanceof RateLimiterRes) {
            return false;
        }

        throw rejection;
    }
};

export default spendPoint;
