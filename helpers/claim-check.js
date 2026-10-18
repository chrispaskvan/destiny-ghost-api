// @ts-check
import { createId } from '@paralleldrive/cuid2';
import cache from './cache.js';

/**
 * How long a receipt outlives its last write. Every write refreshes it, so a
 * broadcast that takes hours, or a delivery report that arrives late, keeps
 * the receipt alive rather than racing a clock started when it was created.
 */
const claimCheckExpiration = 86400; // 1 day in seconds

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
 * Every terminal status shares a rank, so one cannot replace another: a
 * `delivered` followed by a stray `failed` keeps `delivered`. `read` is the
 * exception, being a delivery confirmed further.
 *
 * Twilio's own statuses: https://www.twilio.com/docs/messaging/api/message-resource#message-status-values
 */
const ranks = {
    [PENDING]: 0,
    accepted: 1,
    scheduled: 1,
    queued: 1,
    sending: 2,
    sent: 3,
    delivered: 4,
    undelivered: 4,
    failed: 4,
    canceled: 4,
    [SKIPPED]: 4,
    [DUPLICATE]: 4,
    [ERROR]: 4,
    read: 5,
};

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
 * An entry written before entries were JSON is read as its bare status.
 *
 * KEYS[1] claim check; ARGV[1] phone number, ARGV[2] entry as JSON, ARGV[3]
 * expiry in seconds. Returns 1 when written, 0 when not.
 */
const ADVANCE = `
local ranks = cjson.decode('${JSON.stringify(ranks)}')
local stored = redis.call('HGET', KEYS[1], ARGV[1])

if not stored then
    return 0
end

local ok, current = pcall(cjson.decode, stored)

if not ok or type(current) ~= 'table' then
    current = { status = stored }
end

local entry = cjson.decode(ARGV[2])
local rank = ranks[entry.status]

if rank == nil then
    return 0
end

if current.sid and entry.sid and current.sid ~= entry.sid then
    return 0
end

if rank <= (ranks[current.status] or -1) then
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
        // Written before entries were JSON: the bare status.
    }

    return { status: stored };
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
     * sends it always finds an entry to move forward. A broadcast that
     * resumes after a crash records its last page again, and by then some of
     * those recipients may have been sent to; their entry is kept rather than
     * put back to pending.
     * @param {string} phoneNumber
     */
    async addPhoneNumber(phoneNumber) {
        await cache.hSetNX(this.#number, phoneNumber, JSON.stringify({ status: PENDING }));
        await cache.expire(this.#number, claimCheckExpiration);
    }

    /**
     * Every recipient's progress, or `undefined` when the claim check has
     * expired or was never issued.
     * @param {string} number
     * @returns {Promise<Record<string, ClaimCheckEntry> | undefined>}
     */
    static async getClaimCheck(number) {
        const entries = Object.entries(await cache.hGetAll(number));

        if (!entries.length) return undefined;

        return Object.fromEntries(
            entries.map(([phoneNumber, stored]) => [phoneNumber, parse(stored)]),
        );
    }

    /**
     * Move a recipient forward; see `ADVANCE` for when it does not.
     * @param {string} claimCheckNumber
     * @param {string} phoneNumber
     * @param {ClaimCheckEntry} entry
     * @returns {Promise<boolean>} whether the entry was written
     */
    static async advance(claimCheckNumber, phoneNumber, entry) {
        const written = await cache.eval(ADVANCE, {
            keys: [claimCheckNumber],
            arguments: [phoneNumber, JSON.stringify(entry), String(claimCheckExpiration)],
        });

        return written === 1;
    }
}

export {
    ClaimCheck as default,
    ADVANCE,
    claimCheckExpiration,
    DUPLICATE,
    ERROR,
    PENDING,
    ranks,
    SKIPPED,
};
