/**
 * A module for publishing messages.
 *
 * @module Messenger
 * @summary Publish messages to topics accordingly.
 * @author Chris Paskvan
 * @requires azure
 * {@link https://docs.microsoft.com/en-us/azure/service-bus-messaging/service-bus-nodejs-how-to-use-topics-subscriptions}
 */
const azure = require('azure'),
    settings = require('../settings/serviceBus.json');

class Subscriber {
    /**
     * @constructor
     */
    constructor() {
        const retryOperations = new azure.ExponentialRetryPolicyFilter();

        this.serviceBusService = azure.createServiceBusService(settings.connectionString)
            .withFilter(retryOperations);
    }

	listen(callback) {
		this.serviceBusService.createSubscription(settings.queueName, settings.subscriptionName, (err) => {
			if (err && err.code !== '409') {
				throw err;
			}

			this.getFromTheBus(callback);
		});
    }

	getFromTheBus(callback) {
		this.serviceBusService.receiveSubscriptionMessage(settings.queueName, settings.subscriptionName, {
			isPeekLock: true,
			timeoutIntervalInS: 5
		}, (err, lockedMessage) => {
			if (err) {
				if (err !== 'No messages to receive') {
					throw err;
				}

				setTimeout(() => this.getFromTheBus(callback), 1000);
			} else {
				const { body, customProperties: { notificationtype: notificationType }} = lockedMessage;
				const user = JSON.parse(body);

				callback(user, notificationType);

				this.serviceBusService.deleteMessage(lockedMessage, err => {
					if (err) {
						console.log('message deletion failed: ', err);
					}

					this.getFromTheBus(callback);
				});
			}
		});
	}
}

module.exports = Subscriber;
