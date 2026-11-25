// @ts-check
/**
 * Daily limits on what one number's texts can make the service spend.
 *
 * The per-sender limit in `helpers/rate-limiter.middleware.js` bounds a burst
 * (20 a minute), not a day: a number on an unlimited plan could keep it up
 * around the clock, about 28,800 replies a day, each an MMS while it carries
 * an item icon, and each image scan a Gemini call plus a reply of its own.
 * These bound the day, and step down rather than cut off: past its icons a
 * number still gets its answers, as plain SMS; past its replies it is told
 * once, then gets none until the window passes.
 *
 * STOP, HELP and START are answered before any of this, as carriers require.
 */
import { RateLimiterRedis, RateLimiterRes } from 'rate-limiter-flexible';
import client from './cache.js';
import log from './log.js';

/** Replies one number may receive a day, beyond the compliance keywords. */
const REPLIES_PER_DAY = 100;

/** Replies a day that may carry an item icon, so bill as MMS. */
const ICONS_PER_DAY = 25;

/** Images a day one number may have scanned: each is a Gemini call and a reply. */
const SCANS_PER_DAY = 10;

const DAY = 24 * 60 * 60;
const store = { storeClient: client, useRedisPackage: true };
const replies = new RateLimiterRedis({
    ...store,
    keyPrefix: 'reply-day',
    points: REPLIES_PER_DAY,
    duration: DAY,
});
const icons = new RateLimiterRedis({
    ...store,
    keyPrefix: 'reply-icons',
    points: ICONS_PER_DAY,
    duration: DAY,
});

/** @param {string} from */
const scansKey = from => `mms-scans:${from}`;

/**
 * Grant up to ARGV[1] scans out of what is left of the day, in one step.
 *
 * A script rather than the limiter the other budgets use: a refused
 * `consume()` still adds its point, so a partial grant (three wanted, one
 * left) would leave the counter past the limit, and giving back the one
 * granted after a failed enqueue would not bring the number back under it to
 * send again. This adds only what it grants, and nothing on a refusal.
 *
 * The window opens with the day's first scan and is not stretched by later
 * ones, as the limiter's is not.
 *
 * KEYS[1]: the number's counter. ARGV: wanted, limit, window in seconds.
 * Returns how many were granted.
 */
const RESERVE_SCANS = `
local used = tonumber(redis.call('GET', KEYS[1]) or '0')
local granted = math.min(tonumber(ARGV[1]), tonumber(ARGV[2]) - used)

if granted <= 0 then
    return 0
end

redis.call('INCRBY', KEYS[1], granted)
if redis.call('TTL', KEYS[1]) == -1 then
    redis.call('EXPIRE', KEYS[1], ARGV[3])
end

return granted
`;

/**
 * Give back up to ARGV[1] scans, never below zero, and never to a counter
 * whose window has already closed: DECRBY on a missing key would create one
 * with no expiry, a negative balance that never lapses.
 *
 * KEYS[1]: the number's counter. ARGV: count. Returns how many were refunded.
 */
const REFUND_SCANS = `
local used = tonumber(redis.call('GET', KEYS[1]) or '0')
local refunded = math.min(used, tonumber(ARGV[1]))

if refunded > 0 then
    redis.call('DECRBY', KEYS[1], refunded)
end

return refunded
`;

/**
 * Spend a point.
 * @param {RateLimiterRedis} limiter
 * @param {string} key
 * @returns {Promise<boolean>} false once the limit is spent
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
 * How to answer a number's next text: normally, with the one notice that its
 * day's replies are spent, or not at all.
 *
 * Fails open, as the per-sender limit does: replies are the service, and
 * the burst limit still bounds them while Redis is away.
 * @param {string} from - the sender, in E.164
 * @returns {Promise<'reply' | 'notice' | 'quiet'>}
 */
const answer = async from => {
    if (!client.isReady) {
        return 'reply';
    }

    try {
        await replies.consume(from);

        return 'reply';
    } catch (rejection) {
        if (rejection instanceof RateLimiterRes) {
            /** The first text over the limit is told why; the rest go unanswered. */
            if (rejection.consumedPoints === REPLIES_PER_DAY + 1) {
                log.warn(
                    { from, limit: REPLIES_PER_DAY },
                    "A number's replies for the day are spent.",
                );

                return 'notice';
            }

            return 'quiet';
        }

        log.warn({ err: rejection, from }, 'Unable to check the daily reply limit; replying.');

        return 'reply';
    }
};

/**
 * Whether a reply may carry its item icon. Fails toward plain SMS, the
 * cheaper reply, which loses only the picture.
 * @param {string} from - the sender, in E.164
 * @returns {Promise<boolean>}
 */
const allowIcon = async from => {
    if (!client.isReady) {
        return false;
    }

    try {
        return await spend(icons, from);
    } catch (err) {
        log.warn({ err, from }, 'Unable to check the daily icon limit; replying without it.');

        return false;
    }
};

/**
 * How many of `wanted` images may be scanned, spending one of the day's
 * scans for each: all of them, what is left of the day, or none.
 *
 * Fails closed: a scan is the costliest thing a text can start, and the
 * queue it would go on needs Redis too. The sender is asked to send again.
 * @param {string} from - the sender, in E.164
 * @param {number} wanted
 * @returns {Promise<number>}
 */
const allowScans = async (from, wanted) => {
    if (!client.isReady) {
        log.error({ from }, 'Scan limits unavailable; scanning nothing.');

        return 0;
    }

    let allowed = 0;

    try {
        allowed = Number(
            await client.eval(RESERVE_SCANS, {
                keys: [scansKey(from)],
                arguments: [String(wanted), String(SCANS_PER_DAY), String(DAY)],
            }),
        );
    } catch (err) {
        log.error({ err, from }, 'Unable to check the daily scan limit; scanning nothing.');
    }

    if (allowed < wanted) {
        log.info(
            { from, allowed, wanted, limit: SCANS_PER_DAY },
            'Scans withheld: over the limit.',
        );
    }

    return allowed;
};

/**
 * Give back scans that were allowed but never queued, so a number asked to
 * send again isn't charged twice. Best effort: a failed refund is logged.
 * @param {string} from - the sender, in E.164
 * @param {number} count
 * @returns {Promise<void>}
 */
const refundScans = async (from, count) => {
    try {
        await client.eval(REFUND_SCANS, {
            keys: [scansKey(from)],
            arguments: [String(count)],
        });
    } catch (err) {
        log.warn({ err, from }, 'Unable to refund unqueued scans.');
    }
};

/**
 * @typedef {Object} ReplyLimits
 * @property {typeof answer} answer
 * @property {typeof allowIcon} allowIcon
 * @property {typeof allowScans} allowScans
 * @property {typeof refundScans} refundScans
 */

/** @type {ReplyLimits} */
const replyLimits = { answer, allowIcon, allowScans, refundScans };

export default replyLimits;
export { ICONS_PER_DAY, REPLIES_PER_DAY, SCANS_PER_DAY };
