// @ts-check
/**
 * The consent a sender has been *told* applies, before it has been written.
 *
 * `TwilioController.request()` answers STOP the moment it arrives and hands the
 * durable write to a queue, because carrier compliance requires the reply not to
 * wait on a database (#732). That leaves a window: the sender has an
 * acknowledgement, the worker has not reached Cosmos yet, and a notification
 * executing in between reads permission that has already been withdrawn.
 *
 * This marker is the acknowledgement made readable. It is written to Redis
 * before the reply goes out, so anything that checks consent afterwards sees
 * the sender's intent whether or not Cosmos has caught up.
 *
 * It does not replace the durable write - it covers the gap in front of it, and
 * goes inert as soon as that write lands. See `mayDeliver` for the comparison
 * that decides which of the two is authoritative.
 *
 * @module consentMarker
 */
import cache from './cache.js';
import log from './log.js';
import processExternalPromisesWithTimeout from './process-external-promises-with-timeout.js';

/**
 * Apply a consent change only if nothing newer is already recorded.
 *
 * Two messages from one number can be in flight at once, and nothing orders
 * the Redis calls they make: an older START delayed behind a newer STOP would,
 * with a plain `SET`, land second and leave the marker saying the opposite of
 * what the sender last asked for. `applyConsent` guards the durable copy
 * against exactly this with its stored stamp; this is the same rule, made
 * atomic because Redis has no document to compare against in-process.
 *
 * Strictly older loses and a tie is applied, matching `applyConsent`: two
 * messages sharing a millisecond cannot be ordered by arrival at all, so the
 * one that gets here later wins rather than the earlier one keeping the field
 * by virtue of arriving first.
 */
const RECORD_CONSENT = `
local current = redis.call('HGET', KEYS[1], 'receivedAt')

if current and tonumber(current) > tonumber(ARGV[2]) then
    return 0
end

redis.call('HSET', KEYS[1], 'isSubscribed', ARGV[1], 'receivedAt', ARGV[2])
redis.call('EXPIRE', KEYS[1], ARGV[3])

return 1
`;

/**
 * Long, because the marker is already inert in the normal case: the moment the
 * durable write lands, `consentUpdatedAt` catches up and Cosmos decides
 * instead. The expiry only matters in the case this exists for - the durable
 * write failing for good - where it is what keeps a STOP honoured while
 * somebody acts on the error `applyConsent` logged.
 */
const CONSENT_MARKER_TTL_SECONDS = 86_400;

/**
 * Bounds how long either side of this module can wait on Redis. node-redis
 * queues commands while it reconnects, so an unbounded call does not fail on a
 * dropped connection - it waits for one that may not come back.
 *
 * Both directions need it, for different reasons. An unbounded write holds the
 * webhook open instead of answering a STOP. An unbounded read is worse: it
 * runs as the delivery gate's guard, which `NotificationService` invokes
 * *inside* the rate limiter's slot, and that limiter is `maxConcurrent: 1`
 * cluster-wide. A read that never settles there does not stall one send, it
 * holds the only slot and stalls every outbound message.
 */
const CONSENT_MARKER_TIMEOUT_MS = 250;

/** @param {string} phoneNumber */
const keyFor = phoneNumber => `consent:${phoneNumber}`;

/**
 * What the sender was last told, as recorded at acknowledgement.
 * @typedef {Object} ConsentMarker
 * @property {boolean} isSubscribed
 * @property {number} receivedAt - Epoch milliseconds the message arrived.
 */

/**
 * Record a consent change before replying to it.
 *
 * Never rejects, and never waits longer than the timeout above. A marker that
 * cannot be written leaves the window exactly as wide as it was before this
 * module existed, which is worse than closing it and better than failing to
 * answer a STOP.
 * @param {string} phoneNumber
 * @param {boolean} isSubscribed
 * @param {number} receivedAt - Epoch milliseconds the message arrived.
 * @returns {Promise<void>}
 */
const recordConsent = async (phoneNumber, isSubscribed, receivedAt) => {
    const [result] = await processExternalPromisesWithTimeout(
        [
            cache.eval(RECORD_CONSENT, {
                keys: [keyFor(phoneNumber)],
                arguments: [
                    isSubscribed ? '1' : '0',
                    String(receivedAt),
                    String(CONSENT_MARKER_TTL_SECONDS),
                ],
            }),
        ],
        CONSENT_MARKER_TIMEOUT_MS,
    );

    if (result.status !== 'fulfilled') {
        log.warn(
            {
                phoneNumber,
                isSubscribed,
                ...(result.status === 'rejected' && { err: result.reason }),
                timedOut: result.status === 'timed-out',
            },
            'Unable to record the consent acknowledgement; the durable write still stands.',
        );
    }
};

/**
 * The consent recorded at acknowledgement, if any is still held.
 *
 * Never rejects, and never waits longer than the timeout above. A marker that
 * cannot be read is reported as absent, leaving the caller on the stored state - the position it was in before this module
 * existed. Suppressing everything whenever Redis blinked would be worse, and
 * pointless besides: the send path's rate limiter is Redis-backed too, so a
 * Redis outage already stops messages going out.
 * @param {string} phoneNumber
 * @returns {Promise<ConsentMarker | undefined>}
 */
const readConsent = async phoneNumber => {
    try {
        const [result] = await processExternalPromisesWithTimeout(
            [cache.hGetAll(keyFor(phoneNumber))],
            CONSENT_MARKER_TIMEOUT_MS,
        );

        if (result.status !== 'fulfilled') {
            log.warn(
                {
                    phoneNumber,
                    ...(result.status === 'rejected' && { err: result.reason }),
                    timedOut: result.status === 'timed-out',
                },
                'Unable to read the consent acknowledgement.',
            );

            return undefined;
        }

        const marker = /** @type {Record<string, string> | undefined} */ (result.value);

        if (!marker?.receivedAt) {
            return undefined;
        }

        return {
            isSubscribed: marker.isSubscribed === '1',
            receivedAt: Number(marker.receivedAt),
        };
    } catch (err) {
        log.warn({ err, phoneNumber }, 'Unable to read the consent acknowledgement.');

        return undefined;
    }
};

export { recordConsent, readConsent, CONSENT_MARKER_TTL_SECONDS, RECORD_CONSENT };
