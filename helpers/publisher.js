/**
 * A module for publishing messages.
 *
 * @module Messenger
 * @summary Publish messages to topics accordingly.
 * @author Chris Paskvan
 * @requires azure
 */
const azure = require('azure-sb'),
	azureCommon = require('azure-common'),
	{ connectionString, queueName } = require('../settings/serviceBus.json');

/**
 * Message Publisher
 */
class Publisher {

    /**
     * @constructor
     */
    constructor() {
        const retryOperations = new azureCommon.ExponentialRetryPolicyFilter();

        this.serviceBusService = azure.createServiceBusService(connectionString)
            .withFilter(retryOperations);
    }

    /**
     * Create topic for message.
     *
     * @returns {Request|Promise}
     */
    static createTopic(serviceBusService) {
	    return new Promise((resolve, reject) => {
	        serviceBusService.createTopicIfNotExists(queueName, function (err) {
			    if (err) {
				    return reject(err);
			    }

		        resolve(true);
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
		    serviceBusService.sendTopicMessage(queueName, message, function (err, res) {
			    if (err) {
				    return reject(err);
			    }

			    resolve(res);
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
	sendNotification(user, notificationType = this.constructor.throwIfMissingNotificationType()) {
        const message = {
            body: JSON.stringify(user),
            customProperties: {
                notificationType
            }
        };

        return this.constructor.createTopic(this.serviceBusService)
            .then(success => {
                if (!success) {
                    return false;
                }

                return this.constructor.sendTopicMessage(message, this.serviceBusService)
                    .then(({ isSuccessful = false }) => isSuccessful);
            });
    }
}

module.exports = Publisher;
