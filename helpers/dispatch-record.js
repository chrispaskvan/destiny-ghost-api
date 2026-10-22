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
 * Every write replaces only the record its caller expects to find (see
 * `REPLACE`). BullMQ can run a stalled job again while the original is still
 * going, and two copies writing blind could each undo what the other did.
 *
 * @module dispatchRecord
 */
import boundedCommand from './bounded-cache.js';
import log from './log.js';

/**
 * As long as the claim check it belongs to: a retry after that has no receipt
 * to report to either.
 */
const DISPATCH_RECORD_TTL_SECONDS = 86_400;

/** The claim check's bound, for the same reasons; see `boundedCommand`. */
const DISPATCH_RECORD_TIMEOUT_MS = 1000;

/**
 * @typedef {{ state: 'attempting', at: number, body: string, failedAt?: number }} Attempting
 * `at` is when the send was begun; `failedAt`, when an answer that left its
 * outcome unknown came back.
 * @typedef {{ state: 'accepted', sid: string }} Accepted
 * @typedef {Attempting | Accepted} DispatchRecord
 */

/**
 * @param {string} claimCheckNumber
 * @param {string} phoneNumber
 */
const keyFor = (claimCheckNumber, phoneNumber) => `dispatch:${claimCheckNumber}:${phoneNumber}`;

/**
 * Bounded by `boundedCommand`, which also drops a command still unsent when
 * the timeout passes: an `attempting` that timed out is not written after
 * the send it was meant to precede was abandoned.
 * @template T
 * @param {Parameters<typeof boundedCommand<T>>[0]} command
 * @param {number} timeout
 * @returns {Promise<T>}
 */
const bounded = (command, timeout) => boundedCommand(command, timeout, 'dispatch record');

/**
 * Replace the record only if it still holds what the caller expects (an
 * empty string for none), deleting it when the replacement is empty. Whichever
 * of two copies of a job writes second finds the other's record and backs off,
 * rather than writing over it.
 *
 * KEYS[1] record; ARGV[1] expected, ARGV[2] replacement, ARGV[3] expiry in
 * seconds.
 */
const REPLACE = `
local current = redis.call('GET', KEYS[1]) or ''

if current ~= ARGV[1] then
    return 0
end

if ARGV[2] == '' then
    redis.call('DEL', KEYS[1])
else
    redis.call('SET', KEYS[1], ARGV[2], 'EX', ARGV[3])
end

return 1
`;

/**
 * @param {string} claimCheckNumber
 * @param {string} phoneNumber
 * @param {DispatchRecord | null} expected
 * @param {DispatchRecord | null} replacement
 * @returns {Promise<boolean>} whether it was replaced; rejects when Redis
 * cannot be asked
 */
const replace = async (claimCheckNumber, phoneNumber, expected, replacement) => {
    const replaced = await bounded(
        client =>
            client.eval(REPLACE, {
                keys: [keyFor(claimCheckNumber, phoneNumber)],
                arguments: [
                    expected ? JSON.stringify(expected) : '',
                    replacement ? JSON.stringify(replacement) : '',
                    String(DISPATCH_RECORD_TTL_SECONDS),
                ],
            }),
        DISPATCH_RECORD_TIMEOUT_MS,
    );

    return replaced === 1;
};

/**
 * A write after the send, which never rejects: whatever it would have
 * recorded, a record left as it was is settled by a lookup on the next
 * attempt - it costs a call to Twilio, not a second text.
 * @param {Parameters<typeof replace>} args
 * @param {Record<string, unknown>} context - logged with the failure
 * @param {string} message
 * @returns {Promise<boolean>} whether it was written; `false` when the
 * record had changed, or Redis could not be asked
 */
const settle = async (args, context, message) => {
    try {
        return await replace(...args);
    } catch (err) {
        log.warn({ err, ...context }, message);

        return false;
    }
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
 * Record that a send is about to be made, unless the record has changed
 * since `seen` was read. Rejects when it cannot be written, and the caller
 * must not send.
 * @param {string} claimCheckNumber
 * @param {string} phoneNumber
 * @param {string} body - exactly what is sent, to recognise it by later
 * @param {DispatchRecord | null} seen - what `read` returned
 * @returns {Promise<Attempting | null>} the record this caller wrote, which
 * its later writes expect; `null` when another attempt changed it first
 */
const begin = async (claimCheckNumber, phoneNumber, body, seen) => {
    /** @type {Attempting} */
    const record = { state: 'attempting', at: Date.now(), body };

    return (await replace(claimCheckNumber, phoneNumber, seen, record)) ? record : null;
};

/**
 * Record the SID Twilio accepted the send with.
 * @param {string} claimCheckNumber
 * @param {string} phoneNumber
 * @param {string} sid
 * @param {DispatchRecord} mine - the record this attempt wrote or adopted
 * @returns {Promise<boolean>} whether it was written
 */
const accept = (claimCheckNumber, phoneNumber, sid, mine) =>
    settle(
        [claimCheckNumber, phoneNumber, mine, { state: 'accepted', sid }],
        { claimCheckNumber, phoneNumber, sid },
        'Unable to record the accepted send; a retry will look it up.',
    );

/**
 * Record when an answer that leaves the outcome unknown came back, so the
 * next attempt waits for Twilio to list the message from then, not from when
 * the send began: a `create` that took most of its timeout would otherwise
 * use the wait up before the retry looked.
 * @param {string} claimCheckNumber
 * @param {string} phoneNumber
 * @param {Attempting} mine - the record this attempt wrote
 * @returns {Promise<boolean>} whether it was written
 */
const unsettled = (claimCheckNumber, phoneNumber, mine) =>
    settle(
        [claimCheckNumber, phoneNumber, mine, { ...mine, failedAt: Date.now() }],
        { claimCheckNumber, phoneNumber },
        'Unable to record when the send failed; a retry will wait from when it began.',
    );

/**
 * Drop the record of a send Twilio refused, or one a lookup has found it
 * never took, so a later attempt is not made to wait for it - and a job
 * that then gives up for another reason is not reported as perhaps sent.
 * @param {string} claimCheckNumber
 * @param {string} phoneNumber
 * @param {Attempting} mine - the record this attempt wrote, or read
 * @returns {Promise<boolean>} whether it was dropped
 */
const forget = (claimCheckNumber, phoneNumber, mine) =>
    settle(
        [claimCheckNumber, phoneNumber, mine, null],
        { claimCheckNumber, phoneNumber },
        'Unable to drop a refused send.',
    );

export default { read, begin, accept, unsettled, forget };
export { DISPATCH_RECORD_TIMEOUT_MS, DISPATCH_RECORD_TTL_SECONDS, REPLACE };
