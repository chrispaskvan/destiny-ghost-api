/**
 * A module for queueing broadcasts.
 *
 * @module BroadcastQueue
 * @summary Record a broadcast durably before it is acknowledged.
 */
// @ts-check
import { Queue } from 'bullmq';
import client from '../helpers/jobs.js';
import context from '../helpers/async-context.js';

const QUEUE_NAME = 'broadcasts';

/**
 * A broadcast's job is its durable record: once added, the broadcast is
 * worked through by `NotificationController`'s worker whether or not the
 * process that accepted it survives. Completed jobs are kept as long as the
 * claim check, so progress stays readable for as long as the receipt is;
 * failures are kept for a week, like the other queues.
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
        },
        removeOnFail: {
            age: 604_800,
        },
    },
});

/**
 * How far a broadcast has got, saved on its job after every page.
 * @typedef {Object} BroadcastProgress
 * @property {string} [cursor] - where the next page of subscribers starts
 * @property {number} queued - recipients queued by this broadcast
 * @property {number} duplicates - recipients already queued for this event
 * by another operation
 * @property {boolean} done - every page has been queued
 */

/**
 * Queue a broadcast under its operation's id.
 *
 * The id is the job's id, so adding the same operation twice adds it once.
 * The envelope matches `helpers/publisher.js`, because `helpers/subscriber.js`
 * destructures `applicationProperties` on every job.
 * `weeklyReset` travels with the job because a broadcast that resumes after
 * Tuesday's reset still belongs to the week it was accepted in.
 * @param {{ operationId: string, notificationType: string, weeklyReset: string }} broadcast
 * @returns {Promise<import('bullmq').Job>}
 */
const enqueueBroadcast = async ({ operationId, notificationType, weeklyReset }) => {
    const { traceId } = context.getStore()?.get('logger')?.bindings() || {};

    return await queue.add(
        'broadcast',
        {
            body: JSON.stringify({ weeklyReset }),
            applicationProperties: {
                claimCheckNumber: operationId,
                notificationType,
                traceId,
            },
        },
        { jobId: operationId },
    );
};

/**
 * What a client can learn about a broadcast: where its job stands and how
 * far it has got. Why an attempt failed is left out - BullMQ keeps the raw
 * error, which can name Cosmos or Redis internals - and stays in the log;
 * `state` and `attemptsMade` already say that it is failing and how often.
 * @param {string} operationId
 * @returns {Promise<(BroadcastProgress & {
 *     state: string,
 *     attemptsMade: number,
 * }) | undefined>} undefined when there is no such broadcast, or it is
 * older than its retention
 */
const getBroadcast = async operationId => {
    const job = await queue.getJob(operationId);

    if (!job) {
        return undefined;
    }

    /** @type {BroadcastProgress} */
    const { queued = 0, duplicates = 0, done = false } = job.data.progress ?? {};

    return {
        state: await job.getState(),
        queued,
        duplicates,
        done,
        attemptsMade: job.attemptsMade,
    };
};

export default queue;
export { enqueueBroadcast, getBroadcast, QUEUE_NAME };
