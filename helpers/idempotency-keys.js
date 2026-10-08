// @ts-check
/**
 * Idempotency keys for asynchronous operations.
 *
 * A key is reserved before any work starts and accepted once the work is
 * scheduled, so concurrent requests carrying one key resolve to one
 * operation and a replay returns that operation instead of starting
 * another. See
 * `adr-files/notification-idempotency.md`.
 *
 * @module idempotencyKeys
 */
import { createHmac, hkdfSync, randomUUID } from 'node:crypto';
import cache from './cache.js';
import configuration from './config.js';
import log from './log.js';

/**
 * The key operation ids are signed with: a subkey of the session secret,
 * derived for this purpose alone so it is unrelated to the one that signs
 * cookies. express-session takes one secret or a list, signing with the
 * first.
 */
const OPERATION_ID_KEY = Buffer.from(
    hkdfSync(
        'sha256',
        [configuration.session.secret].flat()[0],
        '',
        'idempotency-operation-id',
        32,
    ),
);

/**
 * How long a reservation outlives the process holding it. The holder renews
 * it for as long as it is working (see `keepAlive`), so this bounds only how
 * long a process that died mid-operation keeps a client's retry waiting, not
 * how long the work may take.
 */
const PENDING_TTL_SECONDS = 60;

/**
 * Renew three times a lease, so one slow or failed renewal does not lose it.
 */
const RENEW_INTERVAL_MS = (PENDING_TTL_SECONDS * 1000) / 3;

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
 * Extend our pending reservation's lease, under the same guard as `ACCEPT`.
 */
const RENEW = `
if redis.call('GET', KEYS[1]) ~= ARGV[1] then
    return 0
end

redis.call('EXPIRE', KEYS[1], ARGV[2])

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
 * @property {string} owner - this request's own mark on the reservation.
 * Two requests for the same thing name the same operation, so without it
 * their reservations would be identical, and one whose lease ran out could
 * renew, accept or release the other's.
 */

/**
 * @typedef {{ outcome: 'reserved' }
 *     | { outcome: 'replay', operationId: string }
 *     | { outcome: 'in-progress' }
 *     | { outcome: 'mismatch' }} ReserveResult
 */

/**
 * The operation a key stands for, derived from the key rather than minted.
 *
 * Every request carrying the same key for the same request names the same
 * operation, so a retry that arrives after a reservation lapsed - its accept
 * failed, say, after the work was already recorded - finds that work under
 * the same id instead of recording it a second time.
 *
 * The id is also the claim check a caller reads progress and receipts with,
 * so it must be as hard to guess as a random one: caller and route are
 * predictable and keys can be short, so a plain hash of them could be
 * worked out by anyone else holding a credential. Keying the hash with a
 * server secret keeps it stable for a retry and unguessable without that
 * secret. Separators keep `caller`, `key` and `fingerprint` from running
 * into one another, and hex keeps the id free of the `:` BullMQ forbids in
 * job ids.
 * @param {Pick<Reservation, 'caller' | 'key' | 'fingerprint'>} reservation
 * @returns {string}
 */
const operationIdFor = ({ caller, key, fingerprint }) =>
    createHmac('sha256', OPERATION_ID_KEY)
        .update(`${caller}\n${key}\n${fingerprint}`)
        .digest('hex');

/** @param {Pick<Reservation, 'caller' | 'key'>} reservation */
const keyFor = ({ caller, key }) => `idempotency:notifications:${caller}:${key}`;

/**
 * @param {Reservation} reservation
 * @param {'pending' | 'accepted'} state
 */
const valueFor = ({ fingerprint, operationId, owner }, state) =>
    JSON.stringify({ operationId, fingerprint, state, owner });

/**
 * A reservation for a request: the operation it names, which is the same
 * for every request like it, and an owner that is this request's alone.
 * @param {Pick<Reservation, 'caller' | 'key' | 'fingerprint'>} request
 * @returns {Reservation}
 */
const reservationFor = request => ({
    ...request,
    operationId: operationIdFor(request),
    owner: randomUUID(),
});

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
 * Hold a pending reservation for as long as its operation is running, so a
 * slow operation is not mistaken for a dead one and started again.
 *
 * A renewal that fails is logged and the next one tries again; a renewal
 * that finds the reservation gone stops, since there is nothing left to hold.
 * @param {Reservation} reservation
 * @returns {() => void} stops renewing
 */
const keepAlive = reservation => {
    const renew = async () => {
        try {
            const renewed = await cache.eval(RENEW, {
                keys: [keyFor(reservation)],
                arguments: [valueFor(reservation, 'pending'), String(PENDING_TTL_SECONDS)],
            });

            if (renewed !== 1) {
                clearInterval(timer);
                log.warn(
                    { operationId: reservation.operationId },
                    'The idempotency key lapsed while its operation was running.',
                );
            }
        } catch (err) {
            log.warn(
                { err, operationId: reservation.operationId },
                'Unable to renew the idempotency key; retrying at the next interval.',
            );
        }
    };
    const timer = setInterval(renew, RENEW_INTERVAL_MS);

    timer.unref();

    return () => clearInterval(timer);
};

/**
 * Record that the reserved operation is fully scheduled, so replays return
 * it.
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
 * Free the key after the reserved operation failed to start or to schedule
 * all of its work, so a retry can start it.
 * @param {Reservation} reservation
 * @returns {Promise<boolean>} false when the reservation was no longer ours
 */
const release = async reservation =>
    (await cache.eval(RELEASE, {
        keys: [keyFor(reservation)],
        arguments: [valueFor(reservation, 'pending')],
    })) === 1;

export { accept, keepAlive, operationIdFor, release, reservationFor, reserve };
