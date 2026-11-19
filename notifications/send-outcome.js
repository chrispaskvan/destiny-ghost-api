// @ts-check
/**
 * What a job that BullMQ has given up on knows about a send it made: shared
 * by every worker that sends through a dispatch record, so they decide alike.
 *
 * @module SendOutcome
 */
import DispatchRecord from '../helpers/dispatch-record.js';
import log from '../helpers/log.js';
import SendOutcomeUnknownError from './send-outcome-unknown.error.js';

/**
 * Whether `err` is one of `type`, or carries its name: matched by name as
 * well, as BullMQ matches its own, so one from another copy of the module is
 * not missed.
 * @param {unknown} err
 * @param {new (...args: any[]) => Error} type
 * @returns {boolean}
 */
const isA = (err, type) =>
    err instanceof type || /** @type {{ name?: unknown }} */ (err)?.name === type.name;

/**
 * The record of a send, for a job BullMQ has given up on: `null` when there
 * is none, and `undefined` when it cannot be read. A caller that only asks
 * about its state treats both alike, leaving the last error to decide; one
 * that must not act on a guess can tell them apart.
 * @param {string} claimCheckNumber
 * @param {string} phoneNumber
 * @returns {Promise<import('../helpers/dispatch-record.js').DispatchRecord | null | undefined>}
 */
const recordOfSend = async (claimCheckNumber, phoneNumber) => {
    try {
        return await DispatchRecord.read(claimCheckNumber, phoneNumber);
    } catch (err) {
        log.warn(
            { err, claimCheckNumber, phoneNumber },
            'Unable to read the record of the send; going by the last error.',
        );

        return undefined;
    }
};

/**
 * Whether a job gave up not knowing if Twilio took its message. Decided by
 * the record of the send as well as the last error: an attempt that may have
 * reached Twilio can be followed by one that fails for some other reason, or
 * stalls, before it gets as far as looking.
 * @param {unknown} err - what the last attempt failed with
 * @param {import('../helpers/dispatch-record.js').DispatchRecord | null | undefined} record
 * @returns {boolean}
 */
const outcomeUnknown = (err, record) =>
    isA(err, SendOutcomeUnknownError) || record?.state === 'attempting';

export { isA, outcomeUnknown, recordOfSend };
