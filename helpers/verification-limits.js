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
import { RateLimiterRedis } from 'rate-limiter-flexible';
import client from './cache.js';
import log from './log.js';
import spendPoint from './spend-point.js';

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
 * Give back a destination's point, for a text the service cap then withheld.
 * Without it, a number asking during a saturated hour would spend its whole
 * day's share on texts it never got, and stay locked out once the hour had
 * passed. Best effort: failing to refund only leaves the point spent.
 * @param {string} key
 * @returns {Promise<void>}
 */
const refund = key =>
    perDestination.reward(key, 1).then(
        () => undefined,
        err => log.warn({ err }, "Unable to refund a destination's verification point."),
    );

/**
 * The bucket an email address is charged to: the mailbox it delivers to, as
 * far as the address can tell, so aliases of one inbox share its share. Only
 * a key; the message still goes to the address as given.
 *
 * A `+tag` is dropped for every domain: subaddressing is how Gmail, Outlook,
 * iCloud and Fastmail all spell an alias of one mailbox, and the rare provider
 * that treats `+` as part of a distinct name only has two people share five a
 * day. Dots are dropped for Gmail alone, the provider that ignores them, and
 * googlemail.com is the same domain.
 * @param {string} address - validated as an email address at sign-up
 * @returns {string}
 */
const mailboxOf = address => {
    const at = address.lastIndexOf('@');
    const domain = address.slice(at + 1).toLowerCase();
    const name = address.slice(0, at).toLowerCase();
    const untagged = name.split('+')[0] || name;

    return ['gmail.com', 'googlemail.com'].includes(domain)
        ? `${untagged.replaceAll('.', '')}@gmail.com`
        : `${untagged}@${domain}`;
};

/**
 * Whether one more verification message may go to `destination`, spending
 * its share of the limits when it may.
 *
 * The destination is charged first, so a flood at one number or address
 * spends its own share and none of the service's. A text the service cap then
 * withholds gets the destination's point back.
 *
 * Fails closed, unlike the route limits: what it guards is billed, the
 * caller has had its answer whatever happens here, and a sign-up whose
 * message was withheld can sign up again for new codes once the limit
 * clears (a resend can't help past the codes' 15 minutes). Redis being
 * unreachable also takes down the sessions sign-up needs, so this rarely
 * withholds anything real.
 * @param {'phone' | 'email'} channel
 * @param {string} destination - the number in E.164, or the email address
 * @returns {Promise<boolean>}
 */
const allowVerification = async (channel, destination) => {
    if (!client.isReady) {
        log.error({ channel }, 'Verification limits unavailable; withholding the message.');

        return false;
    }

    const key = `${channel}:${channel === 'email' ? mailboxOf(destination) : destination}`;

    try {
        if (!(await spendPoint(perDestination, key))) {
            log.warn(
                { channel, limit: PER_DESTINATION_PER_DAY },
                'Verification message withheld: its destination has had its share for the day.',
            );

            return false;
        }
    } catch (err) {
        log.error({ err, channel }, 'Unable to check the verification limits; withholding it.');

        return false;
    }

    if (channel === 'email') {
        return true;
    }

    try {
        if (await spendPoint(allTexts, 'all')) {
            return true;
        }

        log.error(
            { limit: TEXTS_PER_HOUR },
            "Verification text withheld: the service's hourly limit is spent.",
        );
    } catch (err) {
        log.error({ err, channel }, 'Unable to check the verification limits; withholding it.');
    }

    await refund(key);

    return false;
};

export default allowVerification;
export { PER_DESTINATION_PER_DAY, TEXTS_PER_HOUR };
