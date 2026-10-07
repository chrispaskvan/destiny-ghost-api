// @ts-check
/**
 * Idempotency keys for asynchronous operations.
 *
 * A key is reserved before any work starts and accepted once the work has,
 * so concurrent requests carrying one key resolve to one operation and a
 * replay returns that operation instead of starting another. See
 * `adr-files/notification-idempotency.md`.
 *
 * @module idempotencyKeys
 */
import cache from './cache.js';

/**
 * Long enough to start the work - `NotificationController.create` reads the
 * subscriber list before it returns - and short enough that a process dying
 * mid-reservation strands the key for no longer than a client's retry.
 */
const PENDING_TTL_SECONDS = 60;

/**
 * How long a replay returns the original operation. Matches the claim check
 * the operation's receipt lives in.
 */
const ACCEPTED_TTL_SECONDS = 86_400;

/**
 * Promote our pending reservation, and only ours: if the lease ran out and
 * another request reserved the key since, its reservation is left alone.
 */
const ACCEPT = `
if redis.call('GET', KEYS[1]) ~= ARGV[1] then
    return 0
end

redis.call('SET', KEYS[1], ARGV[2], 'EX', ARGV[3])

return 1
`;

/**
 * Give up our pending reservation, under the same guard as `ACCEPT`.
 */
const RELEASE = `
if redis.call('GET', KEYS[1]) ~= ARGV[1] then
    return 0
end

redis.call('DEL', KEYS[1])

return 1
`;

/**
 * @typedef {Object} Reservation
 * @property {string} caller - the credential the request authenticated with
 * @property {string} key - the client's `Idempotency-Key`
 * @property {string} fingerprint - what the request asked for; a key reused
 * for anything else is refused
 * @property {string} operationId - the operation this request would start
 */

/**
 * @typedef {{ outcome: 'reserved' }
 *     | { outcome: 'replay', operationId: string }
 *     | { outcome: 'in-progress' }
 *     | { outcome: 'mismatch' }} ReserveResult
 */

/** @param {Pick<Reservation, 'caller' | 'key'>} reservation */
const keyFor = ({ caller, key }) => `idempotency:notifications:${caller}:${key}`;

/**
 * @param {Reservation} reservation
 * @param {'pending' | 'accepted'} state
 */
const valueFor = ({ fingerprint, operationId }, state) =>
    JSON.stringify({ operationId, fingerprint, state });

/**
 * Claim the key for a new operation, or report what already holds it.
 *
 * A single `SET NX GET`: whichever request lands first reserves the key,
 * and every other sees what that one stored, with no window between the
 * check and the write.
 * @param {Reservation} reservation
 * @returns {Promise<ReserveResult>}
 */
const reserve = async reservation => {
    const previous = await cache.set(keyFor(reservation), valueFor(reservation, 'pending'), {
        condition: 'NX',
        expiration: { type: 'EX', value: PENDING_TTL_SECONDS },
        GET: true,
    });

    if (previous === null) {
        return { outcome: 'reserved' };
    }

    const { fingerprint, operationId, state } = JSON.parse(String(previous));

    if (fingerprint !== reservation.fingerprint) {
        return { outcome: 'mismatch' };
    }

    return state === 'accepted' ? { outcome: 'replay', operationId } : { outcome: 'in-progress' };
};

/**
 * Record that the reserved operation has started, so replays return it.
 * @param {Reservation} reservation
 * @returns {Promise<boolean>} false when the reservation was no longer ours
 */
const accept = async reservation =>
    (await cache.eval(ACCEPT, {
        keys: [keyFor(reservation)],
        arguments: [
            valueFor(reservation, 'pending'),
            valueFor(reservation, 'accepted'),
            String(ACCEPTED_TTL_SECONDS),
        ],
    })) === 1;

/**
 * Free the key after the reserved operation failed to start, so a retry
 * can start it.
 * @param {Reservation} reservation
 * @returns {Promise<boolean>} false when the reservation was no longer ours
 */
const release = async reservation =>
    (await cache.eval(RELEASE, {
        keys: [keyFor(reservation)],
        arguments: [valueFor(reservation, 'pending')],
    })) === 1;

export { accept, release, reserve };
