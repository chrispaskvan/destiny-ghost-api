/**
 * A module for publishing messages.
 *
 * @module Messenger
 * @summary Publish messages to topics accordingly.
 * @author Chris Paskvan
 * @requires azure
 */
import { ServiceBusAdministrationClient, ServiceBusClient } from '@azure/service-bus';
import configuration from './config';
import context from './async-context';

const { serviceBus: { connectionString, queueName } } = configuration;

/**
 * @class Message Publisher
 */
class Publisher {
    /**
     * Azure Service Bus Client
     * @private
     */
    #serviceBusService;

    /**
     * Azure Service Bus Message Sender
     * @private
     */
    #sender;

    /**
     * Create topic for message.
     *
     * @returns {Request|Promise}
     * @private
     */
    async #createTopicAndSender() {
        const serviceBusAdministratorService = new ServiceBusAdministrationClient(connectionString);

        try {
            await serviceBusAdministratorService.createTopic(queueName);
        } catch (err) {
            if (err.statusCode !== 409) {
                throw new Error('Failed to create topic.', { cause: err });
            }
        }

        this.#serviceBusService = new ServiceBusClient(connectionString);
        this.#sender = await this.#serviceBusService.createSender(queueName);
    }

    /**
     * Missing Notification Type Error
     */
    static throwIfMissingNotificationType() {
        throw new Error('notification type is required');
    }

    /**
     * Clean up resources.
     */
    async close() {
        try {
            if (this.#sender) {
                await this.#sender.close();
            }
        } finally {
            if (this.#serviceBusService) {
                await this.#serviceBusService.close();
            }
        }
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
        notificationType = this.constructor.throwIfMissingNotificationType(),
    ) {
        const { traceId } = context.getStore()?.get('logger')?.bindings() || {};
        const message = {
            body: JSON.stringify(user),
            applicationProperties: {
                notificationType,
                traceId,
            },
        };

        if (!this.#sender) {
            await this.#createTopicAndSender();
        }

        return await this.#sender.sendMessages(message);
    }
}

const publisher = new Publisher();

export default publisher;
