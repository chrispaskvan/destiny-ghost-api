// @ts-check
import { createId } from '@paralleldrive/cuid2';
import cache from './cache.js';
import log from './log.js';
import processExternalPromisesWithTimeout from './process-external-promises-with-timeout.js';

/**
 * How long a receipt outlives its last write. Every write refreshes it, so a
 * broadcast that takes hours, or a delivery report that arrives late, keeps
 * the receipt alive rather than racing a clock started when it was created.
 */
const claimCheckExpiration = 86400; // 1 day in seconds

/**
 * Bounds every command to a receipt. node-redis queues commands while it
 * reconnects rather than failing them, so an unbounded one does not fail on
 * a dropped connection - it waits for one that may not come back, holding up
 * whatever awaits it: a send, a Twilio webhook, a shutdown draining its last
 * outcomes, a caller polling the receipt. A receipt is worth less than any of
 * those.
 *
 * Longer than the consent marker's, which sits inside the rate limiter's one
 * slot: a Redis that is slow but answering should still get its receipts.
 *
 * A write that times out is still sent once the client reconnects. That is
 * safe for both: `advance` applies its rank rules whenever it lands, and
 * `addPhoneNumber` never overwrites an entry already there.
 */
const CLAIM_CHECK_TIMEOUT_MS = 1000;

/**
 * Await a receipt command, but no longer than the timeout above.
 * @template T
 * @param {Promise<T>} command
 * @returns {Promise<T>} what the command resolved with; rejects with its
 * error, or with one of its own when it timed out
 */
const bounded = async command => {
    const [result] = await processExternalPromisesWithTimeout([command], CLAIM_CHECK_TIMEOUT_MS);

    if (result.status === 'fulfilled') return result.value;
    if (result.status === 'rejected') throw result.reason;

    throw new Error(`The claim check did not answer within ${CLAIM_CHECK_TIMEOUT_MS}ms.`);
};

/**
 * Write to a receipt without ever failing the caller.
 *
 * Every write here sits beside something worth more than the receipt. Failing
 * a worker after Twilio accepted its message would hand the job back to
 * BullMQ, and the retry would send it a second time - trading a lost receipt
 * for a duplicate SMS. Failing the request that queues a recipient would stop
 * their send over a receipt that only reports on it. Failing a status callback
 * would answer Twilio with an error for a report that was kept. So a write that
 * fails or times out is logged and reported as not written, and the receipt
 * goes without it.
 *
 * Takes the command unbuilt, so a client that throws while building it is
 * caught too, as in `consent-marker.js`.
 * @template T
 * @param {() => Promise<T>} command
 * @param {Record<string, unknown>} context - logged with the failure
 * @param {string} message
 * @returns {Promise<T | undefined>} what the command resolved with, or
 * `undefined` when it did not
 */
const write = async (command, context, message) => {
    try {
        return await bounded(command());
    } catch (err) {
        log.warn({ err, ...context }, message);

        return undefined;
    }
};

/**
 * The status a recipient starts in: their job is in our queue and has not
 * run. Deliberately not `queued`, which is Twilio's word for a message it has
 * already accepted - a receipt that used it for both could not say whether
 * the provider had ever seen the message.
 */
const PENDING = 'pending';

/**
 * The outcome recorded when a send was abandoned on purpose - consent no
 * longer permitted it, or there was nothing to send - with the reason beside
 * it. Every other terminal status but the two below comes from Twilio, so
 * without one of our own a suppressed send is indistinguishable from one that
 * was never attempted.
 */
const SKIPPED = 'skipped';

/**
 * The outcome recorded when a recipient was already queued for the same
 * event by another operation - a second broadcast for the same week, or a
 * retry of one whose reservation lapsed - so this one queued nothing for
 * them. Their delivery is reported on that other operation's receipt.
 */
const DUPLICATE = 'duplicate';

/**
 * The outcome recorded when the job gave up: it failed permanently, or ran
 * out of retries. Not `failed`, which is Twilio's for a message it accepted
 * and could not send.
 */
const ERROR = 'error';

/**
 * How far along each status is. A recipient only ever moves to a higher
 * rank, so a delivery report that arrives late or twice, or a worker that
 * finishes before the request that queued it, cannot move a receipt back.
 *
 * This service's own outcomes - `skipped`, `duplicate`, `error` - rank just
 * above `pending` and below everything Twilio reports. They record that no
 * message of this operation's went out, so they replace only `pending`, and
 * anything Twilio says about a message replaces them: a client timeout on a
 * send Twilio had in fact accepted is corrected by Twilio's first report.
 * Sharing a rank, the first of them recorded stands.
 *
 * Twilio's terminal statuses share a rank too, so one cannot replace another:
 * a `delivered` followed by a stray `failed` keeps `delivered`. `read` ranks
 * above them as a delivery confirmed further, and `ADVANCE` lets it replace
 * `delivered` and nothing else.
 *
 * Twilio's own statuses: https://www.twilio.com/docs/messaging/api/message-resource#message-status-values
 */
const ranks = {
    [PENDING]: 0,
    [SKIPPED]: 1,
    [DUPLICATE]: 1,
    [ERROR]: 1,
    accepted: 2,
    scheduled: 2,
    queued: 2,
    sending: 3,
    sent: 4,
    delivered: 5,
    undelivered: 5,
    failed: 5,
    canceled: 5,
    partially_delivered: 5,
    read: 6,
};

/**
 * How a bare status, written before entries were JSON, is read - by `parse`
 * and `ADVANCE` alike, so a receipt reports the status it is ordered by. Only
 * `queued` is remapped: it then meant both our queue and Twilio's, and is read
 * as the former, since a receipt that under-reports corrects itself on the
 * next report while one that over-reports says Twilio has a message it may
 * never have been sent. Any other bare status is read as itself.
 */
/** @type {Record<string, string>} */
const legacy = { queued: PENDING };

/**
 * @param {Record<string, number | boolean | string>} table
 * @returns {string} the same table as a Lua literal, so the script holds it
 * as code rather than decoding it on every call
 */
const toLua = table =>
    `{ ${Object.entries(table)
        .map(([key, value]) => `[${JSON.stringify(key)}] = ${JSON.stringify(value)}`)
        .join(', ')} }`;

/**
 * Move one recipient's entry forward, or leave it alone.
 *
 * Atomic because the entry is written from three places nothing orders - the
 * request that queued it, the worker that sent it, and Twilio's status
 * callbacks - and a read in one followed by a write could otherwise land
 * after a newer write from another.
 *
 * An entry that is not there is left alone: every recipient is recorded
 * before their job is queued, so a missing one is an expired receipt or a
 * claim check this never issued, and writing one would make a receipt out of
 * a single stray report.
 *
 * Once an entry carries a message sid, only reports for that message move it.
 * A report that arrives before the sid was stored is judged on rank alone,
 * and its sid is kept.
 *
 * An entry written before entries were JSON is read through `legacy`.
 *
 * KEYS[1] claim check; ARGV[1] phone number, ARGV[2] entry as JSON, ARGV[3]
 * expiry in seconds. Returns 1 when written, 0 when not.
 */
const ADVANCE = `
local ranks = ${toLua(ranks)}
local legacy = ${toLua(legacy)}
local stored = redis.call('HGET', KEYS[1], ARGV[1])

if not stored then
    return 0
end

local ok, current = pcall(cjson.decode, stored)

if not ok or type(current) ~= 'table' then
    current = { status = legacy[stored] or stored }
end

local entry = cjson.decode(ARGV[2])
local rank = ranks[entry.status]

if rank == nil then
    return 0
end

if current.sid and entry.sid and current.sid ~= entry.sid then
    return 0
end

local currentRank = ranks[current.status] or -1

if entry.status == 'read' and currentRank == ranks.delivered and current.status ~= 'delivered' then
    return 0
end

if rank <= currentRank then
    if current.sid or not entry.sid then
        return 0
    end

    current.sid = entry.sid
    entry = current
elseif not entry.sid then
    entry.sid = current.sid
end

redis.call('HSET', KEYS[1], ARGV[1], cjson.encode(entry))
redis.call('EXPIRE', KEYS[1], ARGV[3])

return 1
`;

/**
 * One recipient's progress.
 * @typedef {Object} ClaimCheckEntry
 * @property {string} status - `pending`, one of Twilio's message statuses, or
 * `skipped`, `duplicate` or `error`
 * @property {string} [reason] - why a send was skipped or gave up
 * @property {string} [sid] - Twilio's message sid, once it has accepted one
 */

/**
 * @param {string} stored
 * @returns {ClaimCheckEntry}
 */
const parse = stored => {
    try {
        const entry = JSON.parse(stored);

        if (entry && typeof entry === 'object') return entry;
    } catch {
        // Written before entries were JSON: a bare status.
    }

    return { status: legacy[stored] ?? stored };
};

class ClaimCheck {
    /**
     * Claim Check Number
     */
    #number;

    /**
     * @param {string} [number] - an operation's id, when the caller has
     * already minted one; a new id otherwise
     */
    constructor(number = createId()) {
        this.#number = number;
    }

    get number() {
        return this.#number;
    }

    /**
     * Record a recipient as pending, unless they already have an entry.
     *
     * Called before their job is queued, never after, so the worker that
     * sends it finds an entry to move forward. Never rejects (see `write`): a
     * recipient who cannot be recorded is still sent to, and the receipt goes
     * without them - their worker's outcome then finds no entry and is
     * dropped, as one for an expired receipt would be. A broadcast that
     * resumes after a crash records its last page again, and by then some of
     * those recipients may have been sent to; their entry is kept rather than
     * put back to pending.
     * @param {string} phoneNumber
     * @returns {Promise<boolean>} whether the recipient is on the receipt
     */
    async addPhoneNumber(phoneNumber) {
        const number = this.#number;
        // One round trip, and no hash left without its expiry between the two.
        const replies = await write(
            () =>
                cache
                    .multi()
                    .hSetNX(number, phoneNumber, JSON.stringify({ status: PENDING }))
                    .expire(number, claimCheckExpiration)
                    .exec(),
            { claimCheckNumber: number, phoneNumber },
            'Unable to record the recipient on the claim check; sending without it.',
        );

        return replies !== undefined;
    }

    /**
     * Every recipient's progress. Empty for a broadcast that has not queued
     * its first page yet, or has nobody to queue, as much as for a claim
     * check that has expired: Redis cannot tell an empty hash from a missing
     * one, and only the first two are worth a caller polling.
     *
     * Unlike a write, a read rejects when Redis does not answer in time: an
     * empty receipt in its place would tell the caller nobody was queued.
     * @param {string} number
     * @returns {Promise<Record<string, ClaimCheckEntry>>}
     */
    static async getClaimCheck(number) {
        const entries = Object.entries(await bounded(cache.hGetAll(number)));

        return Object.fromEntries(
            entries.map(([phoneNumber, stored]) => [phoneNumber, parse(stored)]),
        );
    }

    /**
     * Move a recipient forward; see `ADVANCE` for when it does not. Never
     * rejects (see `write`).
     * @param {string} claimCheckNumber
     * @param {string} phoneNumber
     * @param {ClaimCheckEntry} entry
     * @returns {Promise<boolean>} whether the entry was written
     */
    static async advance(claimCheckNumber, phoneNumber, entry) {
        const written = await write(
            () =>
                cache.eval(ADVANCE, {
                    keys: [claimCheckNumber],
                    arguments: [phoneNumber, JSON.stringify(entry), String(claimCheckExpiration)],
                }),
            { claimCheckNumber, phoneNumber, outcome: entry },
            'Unable to record the claim-check outcome.',
        );

        return written === 1;
    }
}

export {
    ClaimCheck as default,
    ADVANCE,
    CLAIM_CHECK_TIMEOUT_MS,
    claimCheckExpiration,
    DUPLICATE,
    ERROR,
    legacy,
    PENDING,
    ranks,
    SKIPPED,
};
