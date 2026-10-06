// @ts-check
import { RateLimiterQueue, RateLimiterRedis } from 'rate-limiter-flexible';
import client from './cache.js';

/**
 * Wrap a rate limiter in a FIFO queue so a caller over the limit waits for the next free slot
 * instead of being rejected.
 *
 * @param {import('rate-limiter-flexible').RateLimiterAbstract} rateLimiter
 * @returns {{ schedule: <T>(fn: () => Promise<T>) => Promise<T> }}
 */
export function createScheduler(rateLimiter) {
    const queue = new RateLimiterQueue(rateLimiter);

    return {
        async schedule(fn) {
            await queue.removeTokens(1);

            return await fn();
        },
    };
}

/**
 * Twilio Send Rate Limiter
 * @description Cluster-aware rate limiter for outbound Twilio messages. The token bucket lives
 * in Redis, so the limit is enforced across every horizontally scaled instance of this service
 * rather than per process; callers waiting for a token queue in-process. Every Twilio API call
 * goes through `schedule`, not just the enqueueing of BullMQ jobs.
 *
 * IMPORTANT: 4 messages per second carries forward the effective rate of the limiters this
 * replaced (Bottleneck's minTime of 250ms, and p-throttle's { limit: 2, interval: 500 } before
 * that). That number was never validated against this Twilio account's actual throughput
 * (which depends on Brand/Campaign type and Trust Score for A2P 10DLC — see
 * https://help.twilio.com/articles/1260803225669). Confirm the real limit and adjust points
 * before relying on this in production.
 *
 * @see {@link https://github.com/animir/node-rate-limiter-flexible/wiki/RateLimiterQueue}
 */
export default createScheduler(
    new RateLimiterRedis({
        storeClient: client,
        // Detection keys off the client's class name (`Commander`), which node-redis v6 no longer
        // uses; without this it takes the ioredis path and every consume throws.
        useRedisPackage: true,
        keyPrefix: 'twilio-send',
        points: 4, // 4 messages
        duration: 1, // per 1 second
    }),
);
