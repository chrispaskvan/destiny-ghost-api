// @ts-check
/**
 * A module for sending SMS/MMS notifications.
 *
 * @module Notifications
 * @summary Helper functions for using the Twilio client and recording sent messages.
 * @author Chris Paskvan
 * @description Utility functions for submitting a SMS/MMS message with Twilio,
 * recording the message, and updating the message status.
 */
import configuration from '../helpers/config.js';
import DispatchRecord from '../helpers/dispatch-record.js';
import { withRetry, isTransientError } from '../helpers/retry.js';
import { BRAND_PREFIX, MAX_SMS_MESSAGE_LENGTH } from '../twilio/twilio.constants.js';
import twilioRateLimiter from '../helpers/twilio-rate-limiter.js';
import SendDeferredError from './send-deferred.error.js';
import SendOutcomeUnknownError from './send-outcome-unknown.error.js';

/**
 * How long a send must have been out before a lookup that cannot find it is
 * taken to mean Twilio never took it. Measured against a live account, an
 * accepted message is listed within a second of `create` answering; this is
 * that with room to spare, and still shorter than the first retry's backoff,
 * so the retry after an ambiguous send can decide rather than wait again.
 */
const RECONCILE_AFTER_MS = 5000;

/**
 * Allowance for our clock and Twilio's disagreeing when matching a listed
 * message's `dateCreated` against when the attempt was recorded. Twilio
 * reports whole seconds, so this also covers the truncation.
 */
const CLOCK_SKEW_MS = 60_000;

/**
 * How many of a recipient's latest messages a lookup reads. The match is on
 * the exact body sent in the last few seconds, so it is near the top of the
 * list unless the number has received this many messages since.
 */
const RECONCILE_PAGE_SIZE = 20;

/**
 * Network failures that happen before a request reaches Twilio, so nothing
 * was sent. A timeout or reset is not among them: either can come after
 * Twilio has the request.
 */
const NEVER_CONNECTED = new Set([
    'ECONNREFUSED',
    'EAI_AGAIN',
    'ENOTFOUND',
    'EHOSTUNREACH',
    'ENETUNREACH',
    'UND_ERR_CONNECT_TIMEOUT',
]);

/**
 * Cut a body to the limit without splitting a character. `substring` counts
 * UTF-16 units, so a cut can fall inside an emoji, and half of one goes out
 * as U+FFFD - leaving the text Twilio stores different from the text recorded
 * to recognise it by.
 * @param {string} text
 * @returns {string}
 */
const truncate = text => {
    const cut = text.substring(0, MAX_SMS_MESSAGE_LENGTH);
    const last = cut.charCodeAt(cut.length - 1);

    return last >= 0xd800 && last <= 0xdbff ? cut.slice(0, -1) : cut;
};

/**
 * Whether a failed `create` certainly sent nothing: Twilio answered and
 * refused it (any status under 500, a 429 included), or the request never
 * left. Anything else - a timeout, a reset, a 5xx, an error of a kind not
 * recognised here - may have come after Twilio took it.
 * @param {unknown} err
 * @returns {boolean}
 */
const certainlyNotSent = err => {
    const { status, code } = /** @type {{ status?: unknown, code?: unknown }} */ (err ?? {});

    if (typeof status === 'number') return status < 500;

    return typeof code === 'string' && NEVER_CONNECTED.has(code);
};

/**
 * Twilio's own payload and response types, rather than hand-rolled copies that
 * would drift from the SDK (the client already ships its declarations).
 * @typedef {import('twilio/lib/rest/api/v2010/account/message.js').MessageListInstanceCreateOptions} TwilioMessage
 * @typedef {import('twilio/lib/rest/api/v2010/account/message.js').MessageInstance} SentMessage
 */

/**
 * A message an earlier attempt sent, known from its record alone: its SID,
 * and the status that means Twilio took it. Its delivery reports carry the
 * rest.
 * @typedef {Pick<SentMessage, 'sid' | 'status'>} SettledMessage
 */

/**
 * The subset of the Twilio client this service uses. Kept structural so tests can
 * substitute a stub without constructing a real client.
 * @typedef {{
 *     create: (message: TwilioMessage) => Promise<SentMessage>,
 *     list: (options: { to: string, from: string, limit: number }) => Promise<SentMessage[]>,
 * }} TwilioMessages
 * @typedef {Object} TwilioClient
 * @property {TwilioMessages} messages
 */

/**
 * Notifications Class
 */
class Notifications {
    /**
     * @param {{ client: TwilioClient, limiter?: { schedule: <T>(fn: () => Promise<T>) => Promise<T> } }} options
     */
    constructor(options) {
        this.client = options.client;
        this.limiter = options.limiter ?? twilioRateLimiter;
    }

    /**
     * Send an SMS or MMS message through Twilio, rate limited and retried.
     *
     * A send for a claim check is recorded around the provider call (#719),
     * so a job retried after Twilio took its message does not send it again:
     * the retry finds the record and returns that message instead. See
     * `#reconcile`.
     *
     * @param {string} body - Message body, prefixed and truncated before sending.
     * @param {string} to - Recipient phone number in E.164 format.
     * @param {string} [mediaUrl] - Attachment URL; makes this an MMS.
     * @param {{ claimCheckNumber?: string, notificationType?: string, guard?: () => Promise<boolean> }} [options]
     * `claimCheckNumber` and `notificationType` correlate the delivery
     * callback, and `claimCheckNumber` keys the record of the send. `guard` is
     * checked inside the rate limiter's slot, immediately before the provider
     * call - see below.
     * @returns {Promise<SentMessage | SettledMessage | undefined>} The sent
     * message - or, for a send an earlier attempt made, what its record says
     * about it - or `undefined` when `guard` withheld it.
     * @throws {SendOutcomeUnknownError} when Twilio may have taken the message
     * and nothing yet says whether it did
     * @throws {SendDeferredError} when the send could not be recorded, and so
     * was not made
     */
    async sendMessage(body, to, mediaUrl, { claimCheckNumber, notificationType, guard } = {}) {
        const query =
            claimCheckNumber && notificationType
                ? `?claim-check-number=${claimCheckNumber}&notification-type=${notificationType}`
                : '';
        const text = truncate(`${BRAND_PREFIX}${body}`);
        /** @type {TwilioMessage} */
        const message = {
            to,
            from: configuration.twilio.phoneNumber,
            body: text,
            statusCallback: `${process.env.PROTOCOL}://${process.env.DOMAIN}/twilio/destiny/s${query}`,
        };

        if (mediaUrl) {
            // The SDK types this as an array. A bare string also reaches Twilio
            // intact (serialize.map passes scalars through), and with the
            // client's `arrayFormat: 'repeat'` a single-element array encodes to
            // the identical body — so this matches the contract without
            // changing the request.
            message.mediaUrl = [mediaUrl];
        }

        /** @type {import('../helpers/dispatch-record.js').DispatchRecord | null} */
        let seen = null;

        if (claimCheckNumber) {
            const settled = await this.#reconcile(claimCheckNumber, message);

            if (settled.earlier) return settled.earlier;
            seen = settled.seen;
        }

        const sent = await withRetry(
            () =>
                this.limiter.schedule(async () => {
                    /**
                     * Checked here rather than by the caller, because the wait
                     * for this slot is the gap that matters. The limiter is
                     * cluster-wide at one message per 250ms, so on a broadcast
                     * a recipient can sit in this queue for minutes after the
                     * caller decided to send - long enough for a STOP to
                     * arrive. Callers with nothing to withhold on - the welcome
                     * message, a verification code, a keyword acknowledgement -
                     * pass no guard and are never gated.
                     */
                    if (guard && !(await guard())) {
                        return undefined;
                    }

                    if (!claimCheckNumber) {
                        return await this.client.messages.create(message);
                    }

                    /**
                     * After the guard, so a withheld send leaves no record, and
                     * as the last thing before the provider call, so a record
                     * exists for every message Twilio could have. Written only
                     * if the record is still what `#reconcile` read, so a copy
                     * of this job that got here first, while this one waited
                     * for the slot, is not sent over.
                     */
                    let claimed;

                    try {
                        claimed = await DispatchRecord.begin(claimCheckNumber, to, text, seen);
                    } catch (err) {
                        throw new SendDeferredError(
                            'Unable to record the send, so it was not made.',
                            { cause: err },
                        );
                    }

                    if (!claimed) {
                        throw new SendOutcomeUnknownError(
                            'Another attempt at this send got there first; the next attempt will look it up.',
                        );
                    }

                    try {
                        return await this.client.messages.create(message);
                    } catch (err) {
                        if (certainlyNotSent(err)) {
                            await DispatchRecord.forget(claimCheckNumber, to);
                            throw err;
                        }

                        throw new SendOutcomeUnknownError(
                            'Twilio may have accepted the message; the next attempt will look it up.',
                            { cause: err },
                        );
                    }
                }),
            {
                shouldRetry: isTransientError,
                maxRetries: 0,
            },
        );

        if (claimCheckNumber && sent) {
            await DispatchRecord.accept(claimCheckNumber, to, sent.sid);
        }

        return sent;
    }

    /**
     * Settle what an earlier attempt at this send did, before trying again.
     *
     * - none recorded: nothing was attempted; send.
     * - accepted: Twilio took it; return that message, and send nothing.
     * - attempting: unknown. Look for it among the recipient's latest
     *   messages, matched on the exact body and when it was attempted. Found,
     *   it is adopted as if `create` had answered. Not found once Twilio has
     *   had time to list it, it was never taken; send. Not found sooner,
     *   throw, and look again on the next attempt.
     *
     * A record or lookup that cannot be read is an unknown outcome too:
     * guessing either way risks a duplicate or a loss, and the next attempt
     * may be able to tell. Failing it any other way would let the job end as
     * a plain error, when Twilio may well have the message.
     * @param {string} claimCheckNumber
     * @param {TwilioMessage} message
     * @returns {Promise<{ earlier?: SettledMessage | SentMessage, seen: import('../helpers/dispatch-record.js').DispatchRecord | null }>}
     * the message an earlier attempt sent, if any, and the record as read
     */
    async #reconcile(claimCheckNumber, message) {
        const { to, from } = message;
        let record;

        try {
            record = await DispatchRecord.read(claimCheckNumber, to);
        } catch (err) {
            throw new SendOutcomeUnknownError(
                'Unable to read the record of earlier attempts; the next attempt will look again.',
                { cause: err },
            );
        }

        if (!record) return { seen: null };
        if (record.state === 'accepted') {
            return { earlier: { sid: record.sid, status: 'accepted' }, seen: record };
        }

        const since = record.at - CLOCK_SKEW_MS;
        let listed;

        try {
            listed = await this.client.messages.list({
                to,
                from: /** @type {string} */ (from),
                limit: RECONCILE_PAGE_SIZE,
            });
        } catch (err) {
            throw new SendOutcomeUnknownError(
                'Unable to ask Twilio about an earlier attempt; the next attempt will look again.',
                { cause: err },
            );
        }
        /**
         * Matched on `record.body`, not this attempt's: a retry can compose
         * different text (a Xur inventory read again), and it is the earlier
         * text Twilio would have.
         */
        const found = listed.find(
            candidate =>
                candidate.direction === 'outbound-api' &&
                candidate.body === record.body &&
                new Date(candidate.dateCreated).getTime() >= since,
        );

        if (found) {
            await DispatchRecord.accept(claimCheckNumber, to, found.sid);

            return { earlier: found, seen: record };
        }

        if (Date.now() - record.at < RECONCILE_AFTER_MS) {
            throw new SendOutcomeUnknownError(
                'An earlier attempt is not listed yet; the next attempt will look again.',
            );
        }

        return { seen: record };
    }
}

export default Notifications;
export { CLOCK_SKEW_MS, RECONCILE_AFTER_MS, RECONCILE_PAGE_SIZE };
