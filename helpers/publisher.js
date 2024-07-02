/* eslint-disable max-classes-per-file */
/**
 * A module for publishing messages.
 *
 * @module Messenger
 * @summary Publish messages to topics accordingly.
 * @author Chris Paskvan
 * @requires azure
 */
import { Queue } from 'bullmq';
import cache from './cache';
import context from './async-context';

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

    /**
     * Create a new instance of the Publisher.
     * @constructor
     * @param {string} topic - The topic to publish messages to.
     * @param {object} cache - The cache to use for storing messages.
     * @returns {Publisher} - A new instance of the Publisher.
     */
    constructor(topic = 'notifications') {
        this.#queue = new Queue(topic, cache);
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

        return await this.#queue.add('notification', message);
    }
}

const publisher = new Publisher();

export default publisher;
