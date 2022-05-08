/**
 * A module for publishing messages.
 *
 * @module Messenger
 * @summary Publish messages to topics accordingly.
 * @author Chris Paskvan
 * @requires azure
 */
const { serviceBus: { queueName } } = require('./config');

/**
 * Message Publisher
 */
class Publisher {
    /**
     * @constructor
     */
    constructor(options = {}) {
        this.serviceBusService = options.serviceBusService;
    }

    /**
     * Create topic for message.
     *
     * @returns {Request|Promise}
     */
    static createTopic(serviceBusService) {
        return new Promise((resolve, reject) => {
            serviceBusService.createTopicIfNotExists(queueName, err => {
                if (err) {
                    return reject(err);
                }

                return resolve(true);
            });
        });
    }

    /**
     * Put a message on the topic queue.
     *
     * @param message
     * @param serviceBusService
     * @returns {Promise}
     */
    static sendTopicMessage(message, serviceBusService) {
        return new Promise((resolve, reject) => {
            serviceBusService.sendTopicMessage(queueName, message, (err, res) => {
                if (err) {
                    return reject(err);
                }

                return resolve(res);
            });
        });
    }

    /**
     * Missing Notification Type Error
     */
    static throwIfMissingNotificationType() {
        throw new Error('notification type is required');
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
        const message = {
            body: JSON.stringify(user),
            customProperties: {
                notificationType,
            },
        };
        const success = await this.constructor.createTopic(this.serviceBusService);

        if (!success) {
            return false;
        }

        const { isSuccessful = false } = await this.constructor.sendTopicMessage(
            message,
            this.serviceBusService,
        );

        return isSuccessful;
    }
}

module.exports = Publisher;
