/**
 * A module for publishing messages.
 *
 * @module Messenger
 * @summary Publish messages to topics accordingly.
 * @author Chris Paskvan
 * @requires azure
 */
// @ts-check
import { Queue, QueueEvents } from 'bullmq';
import applicationInsights from './application-insights.js';
import closeAll from './close-all.js';
import client from './jobs.js';
import context from './async-context.js';
import log from './log.js';

class PublisherError extends Error {
    /** @param {string} message */
    constructor(message) {
        super(message);
        this.name = 'PublisherError';
    }
}

/**
 * The identifiers a queued notification travels with - what
 * `NotificationController.#send` reads, and nothing else.
 * @typedef {Object} QueuedUser
 * @property {string} membershipId
 * @property {number} membershipType
 * @property {string} phoneNumber
 */

/**
 * @class Message Publisher
 */
class Publisher {
    /**
     * BullMQ Queue
     * @type {import('bullmq').Queue}
     */
    #queue;
    /** @type {import('bullmq').QueueEvents} */
    #queueEvents;

    /**
     * Create a new instance of the Publisher.
     * @constructor
     * @param {string} [topic] - The topic to publish messages to.
     */
    constructor(topic = 'notifications') {
        this.#queue = new Queue(topic, {
            connection: client,
            defaultJobOptions: {
                attempts: 3,
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
        this.#queueEvents = new QueueEvents(topic, {
            connection: client,
        });
        this.#queueEvents.on('deduplicated', ({ jobId, deduplicationId }, id) => {
            log.info({ id, jobId, deduplicationId }, 'Job deduplicated');
        });
        this.#queueEvents.on('added', ({ jobId }) => {
            log.info({ jobId }, 'Job added to queue');
        });
        this.#queueEvents.on('waiting', ({ jobId }) => {
            log.info({ jobId }, 'Job waiting in queue');
        });
        this.#queueEvents.on('active', ({ jobId }) => {
            log.info({ jobId }, 'Job started processing');
        });
        this.#queueEvents.on('completed', ({ jobId }) => {
            log.info({ jobId }, 'Job completed');
        });
        this.#queueEvents.on('failed', async ({ jobId, failedReason }) => {
            log.error({ jobId, failedReason }, 'Job failed');

            try {
                const job = await this.#queue.getJob(jobId);

                if (job?.opts?.attempts && job.attemptsMade >= job.opts.attempts) {
                    log.error(
                        {
                            jobId,
                            failedReason,
                            attemptsMade: job.attemptsMade,
                        },
                        'Job exhausted all retries',
                    );

                    applicationInsights.trackMetric({
                        name: 'notification-job-exhausted',
                        value: 1,
                    });
                }
            } catch (handlerErr) {
                log.error({ jobId, error: handlerErr }, 'Error in failed event handler');
            }
        });
    }

    /**
     * Missing Notification Type Error
     * @returns {never}
     */
    static throwIfMissingNotificationType() {
        throw new PublisherError('notification type is required');
    }

    /**
     * Missing Claim Check Number Error
     * @returns {never}
     */
    static throwIfMissingClaimCheckNumber() {
        throw new PublisherError('claim check number is required');
    }

    /**
     * Missing Deduplication Id Error
     * @returns {never}
     */
    static throwIfMissingDeduplicationId() {
        throw new PublisherError('deduplication id is required');
    }

    /**
     * Send notification of a specific type to a user.
     *
     * Narrowing happens here rather than at the call sites because the queue
     * is the thing being protected: a BullMQ job outlives the request that
     * created it, sits in Redis for as long as the retry policy allows, and is
     * read back by a worker. Whatever a caller happens to hold - the single
     * recipient path holds the whole Cosmos document, Bungie tokens and all -
     * only the identifiers cross into it, and the worker loads current state
     * for itself.
     *
     * The caller decides what counts as the same notification twice, through
     * `deduplicationId`. A job carrying an id that is already queued, or was
     * in the last week, is not added: BullMQ hands back the job that holds the
     * id instead, so a returned id other than this job's own means it was
     * deduplicated.
     *
     * @param {QueuedUser} user
     * @param {{ notificationType: string, claimCheckNumber: string, deduplicationId: string }} param1
     * @returns {Promise<{ deduplicated: boolean }>}
     */
    async sendNotification(
        user,
        {
            notificationType = /** @type {typeof Publisher} */ (
                this.constructor
            ).throwIfMissingNotificationType(),
            claimCheckNumber = /** @type {typeof Publisher} */ (
                this.constructor
            ).throwIfMissingClaimCheckNumber(),
            deduplicationId = /** @type {typeof Publisher} */ (
                this.constructor
            ).throwIfMissingDeduplicationId(),
        },
    ) {
        const { membershipId, membershipType, phoneNumber } = user;
        const { traceId } = context.getStore()?.get('logger')?.bindings() || {};
        const message = {
            body: JSON.stringify({ membershipId, membershipType, phoneNumber }),
            applicationProperties: {
                claimCheckNumber,
                notificationType,
                traceId,
            },
        };

        // BullMQ refuses a custom id containing ':'; neither part can.
        const jobId = `${claimCheckNumber}-${membershipId}`;
        /**
         * The deduplication key outlives the job it came from. BullMQ's own
         * pruning (`removeOnComplete`/`removeOnFail`, by count or age)
         * leaves it alone, and so does finishing a job while the key has a
         * TTL; only an explicit removal - `job.remove()`, `queue.clean()` -
         * deletes it. So the retention above can stay short without
         * shortening the week this holds a repeat back for.
         */
        const result = await this.#queue.add('notification', message, {
            jobId,
            deduplication: {
                id: deduplicationId,
                ttl: 604_800_000,
            },
        });
        const deduplicated = result.id !== jobId;

        log.info(
            {
                jobId: result.id,
                notificationType,
                phoneNumber,
                deduplicationId,
                deduplicated,
            },
            'Message published to queue',
        );

        return { deduplicated };
    }

    /**
     * Clean up resources. The shared jobs connection is left open: BullMQ
     * does not own it, and `server.js` quits it once everything that uses it
     * has closed.
     */
    async close() {
        await closeAll(
            [this.#queueEvents.close(), this.#queue.close()],
            'Publisher failed to close',
        );
    }
}

const publisher = new Publisher();

export default publisher;
