// @ts-check
/**
 * Where a BullMQ job stands against its attempts, in one place for everything
 * that reports on it - the exhausted-retries metric and the claim check - so
 * the two cannot disagree about when a job has run out.
 *
 * `attemptsMade` counts attempts that have failed; a job with no `attempts`
 * of its own is tried once, as BullMQ does.
 *
 * @module jobAttempts
 */

/**
 * @param {import('bullmq').Job} job
 * @returns {number}
 */
const attemptsAllowed = job => job.opts?.attempts ?? 1;

/**
 * Whether a failed job has used every attempt it was allowed.
 * @param {import('bullmq').Job} job
 * @returns {boolean}
 */
const isExhausted = job => job.attemptsMade >= attemptsAllowed(job);

/**
 * Whether the attempt now running is the job's last, so that failing it
 * fails the job.
 * @param {import('bullmq').Job} job
 * @returns {boolean}
 */
const isLastAttempt = job => job.attemptsMade + 1 >= attemptsAllowed(job);

export { isExhausted, isLastAttempt };
