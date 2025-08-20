/**
 * A module for publishing messages.
 *
 * @module Messenger
 * @summary Publish messages to topics accordingly.
 * @author Chris Paskvan
 * @requires azure
 */
import { Queue, QueueEvents } from 'bullmq';
import client from './jobs.js';
import context from './async-context';
import log from './log';

class PublisherError extends Error {
    constructor(message) {
        super(message);
        this.name = 'PublisherError';
    }
}

/**
 * @class Message Publisher
 */
class Publisher {
    /**
     * BullMQ Queue
     * @private
     */
    #queue;
    #queueEvents;

    /**
     * Create a new instance of the Publisher.
     * @constructor
     * @param {string} topic - The topic to publish messages to.
     * @param {object} cache - The cache to use for storing messages.
     * @returns {Publisher} - A new instance of the Publisher.
     */
    constructor(topic = 'notifications') {
        this.#queue = new Queue(topic, {
            connection: client,
        });
        this.#queueEvents = new QueueEvents(topic, {
            connection: client,
        });
        this.#queueEvents.on('deduplicated', ({ jobId, deduplicationId }, id) => {
            console.log(`Job ${id} was deduplicated due to existing job ${jobId} with deduplication Id ${deduplicationId}`);
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
        this.#queueEvents.on('failed', ({ jobId, failedReason }) => {
            log.error({ jobId, failedReason }, 'Job failed');
        });
    }

    /**
     * Missing Notification Type Error
     */
    static throwIfMissingNotificationType() {
        throw new PublisherError('notification type is required');
    }

    /**
     * Missing Claim Check Number Error
     */
    static throwIfMissingClaimCheckNumber() {
        throw new PublisherError('claim check number is required');
    }

    /**
     * Send notification of a specific type to a user.
     *
     * @param user
     * @param notificationType - required
     * @returns {Promise}
     */
    async sendNotification(
        user,
        {
            notificationType = this.constructor.throwIfMissingNotificationType(),
            claimCheckNumber = this.constructor.throwIfMissingClaimCheckNumber(),
        },
    ) {
        const { traceId } = context.getStore()?.get('logger')?.bindings() || {};
        const message = {
            body: JSON.stringify(user),
            applicationProperties: {
                claimCheckNumber,
                notificationType,
                traceId,
            },
        };

        const result = await this.#queue.add('notification', message,
            {
                deduplication: {
                    id: `${notificationType}-${user.phoneNumber}`,
                    ttl: 3_600_000,
                }
            }
        );
        
        log.info({ 
            jobId: result.id, 
            notificationType, 
            phoneNumber: user.phoneNumber,
            deduplicationId: `${notificationType}-${user.phoneNumber}`
        }, 'Message published to queue');
        
        return result;
    }
}

const publisher = new Publisher();

export default publisher;
