/**
 * A module for queueing sign-ups and their resends.
 *
 * @module SignUpQueue
 * @summary Answer sign-up before doing the work, so timing can't reveal a conflict.
 */
// @ts-check
import { setTimeout as delay } from 'node:timers/promises';
import { Queue } from 'bullmq';
import client from '../helpers/jobs.js';
import context from '../helpers/async-context.js';
import log from '../helpers/log.js';

const QUEUE_NAME = 'sign-up';

/**
 * `POST /users/signUp` answers `204` whatever happens, but answered after the
 * work, its latency told a conflict (two lookups) from a sign-up (a save and
 * two billed sends). A resend after a conflict finds nothing to send, so its
 * latency told them apart too. Both now answer once the job is queued, which
 * takes the same time either way (#795).
 *
 * Tried once, never again. Every step after the save sends a billed message
 * (#793), so a retry would send twice; a sign-up that fails is logged, and
 * the user signs up again. The worker doesn't pick a stalled job up again for
 * the same reason (`maxStalledCount: 0` in `UserController`).
 *
 * The job carries the submitted contact, so it is removed as soon as it
 * finishes, whether it completed or failed. Age-based removal would not do:
 * BullMQ runs no timer, so an expired job is only pruned when another one
 * finishes after it, and with no later failure, a failed job's contact would
 * stay in Redis for good. A failure is logged by the subscriber, and the user
 * signs up again. The codes are minted in the job, so none ever reaches
 * Redis.
 */
const queue = new Queue(QUEUE_NAME, {
    connection: client,
    defaultJobOptions: {
        attempts: 1,
        removeOnComplete: true,
        removeOnFail: true,
    },
});

/**
 * One job at a time across every instance, not just per worker: the
 * worker's own `concurrency: 1` holds only within one process. Two sign-ups
 * from one account running at once read the same ETag, and the later one,
 * say a typo fixed, fails its save with a 412 and, tried only once, is lost
 * after its caller was told 204. Run in order, the later one wins.
 *
 * `UserController` awaits this before it starts the worker, so no instance
 * works the queue without the limit: while Redis can't be reached, this
 * keeps trying, and the queued sign-ups wait rather than race. Stored on the
 * queue in Redis, so setting it again at each start is harmless. It gives up
 * only once the queue is closing, resolving `false`, and its wait between
 * tries doesn't hold the process open.
 * @param {{ retryDelay?: number }} [options] - milliseconds between tries
 * @returns {Promise<boolean>} whether the limit is set
 */
const limitConcurrency = async ({ retryDelay = 5_000 } = {}) => {
    for (let attempt = 1; !queue.closing; attempt += 1) {
        try {
            await queue.setGlobalConcurrency(1);

            return true;
        } catch (err) {
            log.warn(
                { err, queueName: QUEUE_NAME, attempt },
                "Failed to set the sign-up queue's global concurrency; its jobs wait until it is.",
            );
            await delay(retryDelay, undefined, { ref: false });
        }
    }

    return false;
};

/**
 * The envelope matches `helpers/publisher.js`, because `helpers/subscriber.js`
 * destructures `applicationProperties` on every job.
 * @param {'sign-up' | 'resend'} name
 * @param {object} data
 * @returns {Promise<import('bullmq').Job>}
 */
const enqueue = async (name, data) => {
    const { traceId } = context.getStore()?.get('logger')?.bindings() || {};

    return await queue.add(name, {
        body: JSON.stringify(data),
        applicationProperties: { traceId },
    });
};

/**
 * Queue a sign-up.
 * @param {{ displayName: string, membershipType: number, contact: { emailAddress: string, firstName: string, lastName: string, phoneNumber: string } }} signUp
 * @returns {Promise<import('bullmq').Job>}
 */
const enqueueSignUp = ({ displayName, membershipType, contact }) =>
    enqueue('sign-up', { displayName, membershipType, contact });

/**
 * Queue a resend of a pending sign-up's message on one channel.
 * @param {{ displayName: string, membershipType: number, channel: 'phone' | 'email' }} resend
 * @returns {Promise<import('bullmq').Job>}
 */
const enqueueResend = ({ displayName, membershipType, channel }) =>
    enqueue('resend', { displayName, membershipType, channel });

export default queue;
export { enqueueResend, enqueueSignUp, limitConcurrency, QUEUE_NAME };
