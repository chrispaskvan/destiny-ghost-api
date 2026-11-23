// @ts-check
/**
 * Limits on the verification messages sign-up sends, by where they go.
 *
 * The route limits (`helpers/rate-limiter.middleware.js`) charge the account
 * and the network asking, which is all a request knows: a resend doesn't name
 * its destination, the pending sign-up does. These charge the destination, so
 * many accounts can't add up to a flood at one number or address, and cap the
 * service's verification texts as a whole, so many destinations can't add up
 * to a bill. Both are checked by the sign-up worker as it sends.
 */
import { RateLimiterRedis, RateLimiterRes } from 'rate-limiter-flexible';
import client from './cache.js';
import log from './log.js';

/**
 * Verification messages one phone number or email address may receive a day,
 * whichever accounts ask. A sign-up, a couple of resends and a second try at
 * the form fit; a stranger's inbox being used as a target doesn't.
 */
const PER_DESTINATION_PER_DAY = 5;

/**
 * Verification texts the whole service may send an hour. Real sign-ups come
 * a few a day, so reaching this is a signal, logged as an error to alert on,
 * and the ceiling on what a pumping run can cost before someone looks.
 */
const TEXTS_PER_HOUR = 50;

const store = { storeClient: client, useRedisPackage: true };
const perDestination = new RateLimiterRedis({
    ...store,
    keyPrefix: 'verification-destination',
    points: PER_DESTINATION_PER_DAY,
    duration: 24 * 60 * 60,
});
const allTexts = new RateLimiterRedis({
    ...store,
    keyPrefix: 'verification-texts',
    points: TEXTS_PER_HOUR,
    duration: 60 * 60,
});

/**
 * Spend a point.
 * @param {RateLimiterRedis} limiter
 * @param {string} key
 * @returns {Promise<boolean>} false when the limit is spent
 * @throws when Redis can't answer
 */
const spend = async (limiter, key) => {
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

/**
 * Whether one more verification message may go to `destination`, spending
 * its share of the limits when it may.
 *
 * Fails closed, unlike the route limits: what it guards is billed, the
 * caller has had its answer whatever happens here, and a sign-up whose
 * message was withheld can be resent. Redis being unreachable also takes
 * down the sessions sign-up needs, so this rarely withholds anything real.
 * @param {'phone' | 'email'} channel
 * @param {string} destination - the number in E.164, or the email address
 * @returns {Promise<boolean>}
 */
const allowVerification = async (channel, destination) => {
    if (!client.isReady) {
        log.error({ channel }, 'Verification limits unavailable; withholding the message.');

        return false;
    }

    try {
        if (!(await spend(perDestination, `${channel}:${destination.toLowerCase()}`))) {
            log.warn(
                { channel, limit: PER_DESTINATION_PER_DAY },
                'Verification message withheld: its destination has had its share for the day.',
            );

            return false;
        }

        if (channel === 'phone' && !(await spend(allTexts, 'all'))) {
            log.error(
                { limit: TEXTS_PER_HOUR },
                "Verification text withheld: the service's hourly limit is spent.",
            );

            return false;
        }

        return true;
    } catch (err) {
        log.error({ err, channel }, 'Unable to check the verification limits; withholding it.');

        return false;
    }
};

export default allowVerification;
export { PER_DESTINATION_PER_DAY, TEXTS_PER_HOUR };
