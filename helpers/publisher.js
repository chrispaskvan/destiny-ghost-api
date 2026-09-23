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
     * @param {QueuedUser} user
     * @param {{ notificationType: string, claimCheckNumber: string }} param1
     * @returns {Promise<*>}
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

        const deduplicationId = `${notificationType}-${phoneNumber}`;
        const result = await this.#queue.add('notification', message, {
            deduplication: {
                id: deduplicationId,
                ttl: 3_600_000,
            },
        });

        log.info(
            {
                jobId: result.id,
                notificationType,
                phoneNumber,
                deduplicationId,
            },
            'Message published to queue',
        );

        return result;
    }
}

const publisher = new Publisher();

export default publisher;
