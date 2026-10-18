// @ts-check
/**
 * Why a broadcast failed, in words written for whoever reads its progress.
 *
 * A broadcast's failure reason is shown to callers, and errors are private
 * by default (`adr-files/client-safe-error-messages.md`). The worker fails
 * with these messages and logs the raw error; anything else BullMQ records
 * as the reason - its own "job stalled more than allowable limit", or an
 * error thrown before the worker ran - is reported as `UNKNOWN`.
 *
 * @module BroadcastFailures
 */

const SUBSCRIBERS_UNREADABLE = 'Subscribers could not be read.';
const PROGRESS_UNSAVED = 'Progress could not be saved.';
const UNKNOWN = 'The broadcast could not be completed.';

/**
 * @param {number} failed
 * @param {number} total
 * @returns {string}
 */
const recipientsNotQueued = (failed, total) =>
    `${failed} of ${total} recipients on this page could not be queued.`;

const RECIPIENTS_NOT_QUEUED = /^\d+ of \d+ recipients on this page could not be queued\.$/;

/**
 * The reason to show for a failed attempt: the worker's own message as it
 * is, anything else as `UNKNOWN`.
 * @param {string | undefined} reason - BullMQ's `failedReason`
 * @returns {string | undefined} undefined when nothing has failed
 */
const callerSafe = reason => {
    if (!reason) {
        return undefined;
    }

    return reason === SUBSCRIBERS_UNREADABLE ||
        reason === PROGRESS_UNSAVED ||
        RECIPIENTS_NOT_QUEUED.test(reason)
        ? reason
        : UNKNOWN;
};

export { callerSafe, PROGRESS_UNSAVED, recipientsNotQueued, SUBSCRIBERS_UNREADABLE, UNKNOWN };
