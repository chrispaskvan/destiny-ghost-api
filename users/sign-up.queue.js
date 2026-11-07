/**
 * A module for queueing sign-ups and their resends.
 *
 * @module SignUpQueue
 * @summary Answer sign-up before doing the work, so timing can't reveal a conflict.
 */
// @ts-check
import { Queue } from 'bullmq';
import client from '../helpers/jobs.js';
import context from '../helpers/async-context.js';

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
 * The job carries the submitted contact, so it is removed once it completes,
 * and kept a day when it fails, long enough to look into. The codes are
 * minted in the job, so none ever reaches Redis.
 */
const queue = new Queue(QUEUE_NAME, {
    connection: client,
    defaultJobOptions: {
        attempts: 1,
        removeOnComplete: true,
        removeOnFail: {
            age: 86_400,
        },
    },
});

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
export { enqueueResend, enqueueSignUp, QUEUE_NAME };
