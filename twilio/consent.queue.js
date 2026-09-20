/**
 * A module for queueing SMS consent changes.
 *
 * @module ConsentQueue
 * @summary Persist STOP/START intent durably, independently of the reply.
 */
// @ts-check
import { Queue } from 'bullmq';
import client from '../helpers/jobs.js';
import context from '../helpers/async-context.js';

const QUEUE_NAME = 'consent';

/**
 * Carrier compliance rides on this write landing, and the sender has already
 * been told it applied by the time the job runs, so it is retried more
 * patiently than a notification. Failures are kept for a week so an operator
 * can see which numbers never persisted.
 */
const queue = new Queue(QUEUE_NAME, {
    connection: client,
    defaultJobOptions: {
        attempts: 5,
        backoff: {
            type: 'exponential',
            delay: 1000,
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
 * Queue a consent change.
 *
 * Deliberately undeduplicated: STOP, START and STOP again are three distinct
 * intents from the same number, and collapsing them would silently discard the
 * one the guardian meant. The envelope matches `helpers/publisher.js` because
 * `helpers/subscriber.js` destructures `applicationProperties` on every job.
 * `receivedAt` travels with the job because a retry can resume long after a
 * later message has been written; the worker compares it against what is
 * stored rather than trusting the order jobs happen to run in.
 * @param {{ phoneNumber: string, isSubscribed: boolean, receivedAt: number }} consent
 * @returns {Promise<import('bullmq').Job>}
 */
const enqueueConsentChange = async ({ phoneNumber, isSubscribed, receivedAt }) => {
    const { traceId } = context.getStore()?.get('logger')?.bindings() || {};

    return await queue.add('consent', {
        body: JSON.stringify({ phoneNumber, isSubscribed, receivedAt }),
        applicationProperties: { traceId },
    });
};

export default queue;
export { enqueueConsentChange, QUEUE_NAME };
