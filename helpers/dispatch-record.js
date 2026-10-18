// @ts-check
/**
 * What we know about one recipient's send for one operation, kept so a retry
 * can tell a message Twilio already took from one it never saw (#719).
 *
 * Twilio has no idempotency key for creating a message, so nothing on its side
 * stops a retried job texting someone twice. This is the record a retry checks
 * instead: written as `attempting` immediately before the provider call, and
 * moved to `accepted` once Twilio answers with a SID. A retry that finds
 * `accepted` sends nothing; one that finds `attempting` does not know, and has
 * to ask Twilio before it decides.
 *
 * Unlike the claim check, which only reports, this decides whether to send, so
 * `begin` and `read` reject rather than swallow a failure: a send that cannot
 * be recorded, or a retry that cannot see the record, waits for the next
 * attempt rather than going ahead blind.
 *
 * @module dispatchRecord
 */
import cache from './cache.js';
import log from './log.js';
import processExternalPromisesWithTimeout from './process-external-promises-with-timeout.js';

/**
 * As long as the claim check it belongs to: a retry after that has no receipt
 * to report to either.
 */
const DISPATCH_RECORD_TTL_SECONDS = 86_400;

/**
 * `begin` runs inside the rate limiter's slot, which is one at a time
 * cluster-wide, so it gets the consent marker's bound: a Redis that does not
 * answer must not stall every outbound message behind it.
 */
const DISPATCH_RECORD_SLOT_TIMEOUT_MS = 250;

/** Reads and `accept` run outside the slot, and get the claim check's bound. */
const DISPATCH_RECORD_TIMEOUT_MS = 1000;

/**
 * @typedef {{ state: 'attempting', at: number, body: string }} Attempting
 * @typedef {{ state: 'accepted', sid: string }} Accepted
 * @typedef {Attempting | Accepted} DispatchRecord
 */

/**
 * @param {string} claimCheckNumber
 * @param {string} phoneNumber
 */
const keyFor = (claimCheckNumber, phoneNumber) => `dispatch:${claimCheckNumber}:${phoneNumber}`;

/**
 * Run a command against the cache, no longer than the timeout. node-redis's
 * own timeout drops a command still unsent when it passes, so an `attempting`
 * that timed out is not written after the send it was meant to precede was
 * abandoned.
 * @template T
 * @param {(client: typeof cache) => Promise<T>} command
 * @param {number} timeout
 * @returns {Promise<T>}
 */
const bounded = async (command, timeout) => {
    const [result] = await processExternalPromisesWithTimeout(
        [command(cache.withCommandOptions({ timeout }))],
        timeout,
    );

    if (result.status === 'fulfilled') return result.value;
    if (result.status === 'rejected') throw result.reason;

    throw new Error(`The dispatch record did not answer within ${timeout}ms.`);
};

/**
 * @param {string} claimCheckNumber
 * @param {string} phoneNumber
 * @returns {Promise<DispatchRecord | null>} rejects when it cannot be read
 */
const read = async (claimCheckNumber, phoneNumber) => {
    const value = await bounded(
        client => client.get(keyFor(claimCheckNumber, phoneNumber)),
        DISPATCH_RECORD_TIMEOUT_MS,
    );

    return value ? JSON.parse(value) : null;
};

/**
 * Record that a send is about to be made. Rejects when it cannot, and the
 * caller must not send.
 * @param {string} claimCheckNumber
 * @param {string} phoneNumber
 * @param {string} body - exactly what is sent, to recognise it by later
 * @returns {Promise<void>}
 */
const begin = async (claimCheckNumber, phoneNumber, body) => {
    /** @type {Attempting} */
    const record = { state: 'attempting', at: Date.now(), body };

    await bounded(
        client =>
            client.set(keyFor(claimCheckNumber, phoneNumber), JSON.stringify(record), {
                EX: DISPATCH_RECORD_TTL_SECONDS,
            }),
        DISPATCH_RECORD_SLOT_TIMEOUT_MS,
    );
};

/**
 * Record the SID Twilio accepted the send with. Never rejects: the message is
 * already out, and a record left at `attempting` is still recognised by its
 * body on a retry - it costs a lookup, not a second text.
 * @param {string} claimCheckNumber
 * @param {string} phoneNumber
 * @param {string} sid
 * @returns {Promise<void>}
 */
const accept = async (claimCheckNumber, phoneNumber, sid) => {
    /** @type {Accepted} */
    const record = { state: 'accepted', sid };

    try {
        await bounded(
            client =>
                client.set(keyFor(claimCheckNumber, phoneNumber), JSON.stringify(record), {
                    EX: DISPATCH_RECORD_TTL_SECONDS,
                }),
            DISPATCH_RECORD_TIMEOUT_MS,
        );
    } catch (err) {
        log.warn(
            { err, claimCheckNumber, phoneNumber, sid },
            'Unable to record the accepted send; a retry will look it up.',
        );
    }
};

/**
 * Drop the record of a send Twilio refused, so a later attempt is not made to
 * wait for one that was never taken. Never rejects: a record left behind is
 * still resolved by a lookup that finds nothing.
 * @param {string} claimCheckNumber
 * @param {string} phoneNumber
 * @returns {Promise<void>}
 */
const forget = async (claimCheckNumber, phoneNumber) => {
    try {
        await bounded(
            client => client.del(keyFor(claimCheckNumber, phoneNumber)),
            DISPATCH_RECORD_TIMEOUT_MS,
        );
    } catch (err) {
        log.warn({ err, claimCheckNumber, phoneNumber }, 'Unable to drop a refused send.');
    }
};

export default { read, begin, accept, forget };
export { DISPATCH_RECORD_SLOT_TIMEOUT_MS, DISPATCH_RECORD_TIMEOUT_MS, DISPATCH_RECORD_TTL_SECONDS };
