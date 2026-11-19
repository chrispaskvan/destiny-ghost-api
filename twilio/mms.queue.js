/**
 * A module for queueing inbound MMS images.
 *
 * @module MmsQueue
 * @summary Record an image durably before its receipt is acknowledged.
 */
// @ts-check
import { Queue } from 'bullmq';
import client from '../helpers/jobs.js';
import context from '../helpers/async-context.js';

const QUEUE_NAME = 'mms';

/**
 * How long a delivered webhook is remembered, so Twilio delivering the same
 * message again adds nothing. Far longer than Twilio keeps retrying.
 */
const DEDUPLICATION_TTL_MS = 86_400_000;

/**
 * The job is the image's durable record: once added, it is processed by
 * `MmsService`'s worker whether or not the process that acknowledged it
 * survives. Completions are kept a day and failures a week, and each is
 * capped by count, like the other queues, since a job holds its saved reply
 * text.
 *
 * Five attempts, as for notifications: a reply whose outcome is unknown can
 * be settled only once Twilio has had time to list it, and retries landing
 * about 5, 15, 35 and 75 seconds after the first failure leave one after
 * that. Each attempt resumes from the images already analyzed, so a retry
 * repeats an AI call only for an image that never got that far.
 */
const queue = new Queue(QUEUE_NAME, {
    connection: client,
    defaultJobOptions: {
        attempts: 5,
        backoff: {
            type: 'exponential',
            delay: 5000,
        },
        removeOnComplete: {
            age: 86_400,
            count: 1000,
        },
        removeOnFail: {
            age: 604_800,
            count: 500,
        },
    },
});

/**
 * An image to analyze, as the worker receives it.
 * @typedef {Object} MmsJob
 * @property {string} messageSid - The inbound message's SID.
 * @property {string} from - The sender's phone number.
 * @property {import('./mms.service.js').MmsMedia[]} media - Twilio-hosted
 * images. The worker signs its own requests for them, so no credential is
 * queued.
 */

/**
 * Queue an inbound message's images, once per message SID.
 *
 * The envelope matches `helpers/publisher.js`, because
 * `helpers/subscriber.js` destructures `applicationProperties` on every job.
 * @param {MmsJob} mms
 * @returns {Promise<import('bullmq').Job>}
 */
const enqueueMms = async ({ messageSid, from, media }) => {
    const { traceId } = context.getStore()?.get('logger')?.bindings() || {};

    return await queue.add(
        'mms',
        {
            body: JSON.stringify({ messageSid, from, media }),
            applicationProperties: { traceId },
        },
        { deduplication: { id: messageSid, ttl: DEDUPLICATION_TTL_MS } },
    );
};

export default queue;
export { DEDUPLICATION_TTL_MS, enqueueMms, QUEUE_NAME };
