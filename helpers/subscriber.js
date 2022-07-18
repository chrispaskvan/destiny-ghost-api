/**
 * A module for publishing messages.
 *
 * @module Messenger
 * @summary Publish messages to topics accordingly.
 * @author Chris Paskvan
 * @requires azure
 * {@link https://docs.microsoft.com/en-us/azure/service-bus-messaging/service-bus-nodejs-how-to-use-topics-subscriptions}
 */
import { createServiceBusService } from 'azure-sb';
import { ExponentialRetryPolicyFilter } from 'azure-common';
import configuration from './config';
import log from './log';

const { serviceBus: settings } = configuration;

class Subscriber {
    /**
     * @constructor
     */
    constructor() {
        const retryOperations = new ExponentialRetryPolicyFilter();

        this.serviceBusService = createServiceBusService(settings.connectionString)
            .withFilter(retryOperations);
    }

    listen(callback) {
        this.serviceBusService
            .createSubscription(settings.queueName, settings.subscriptionName, err => {
                if (err && err.code !== '409') {
                    throw err;
                }

                this.getFromTheBus(callback);
            });
    }

    getFromTheBus(callback) {
        this.serviceBusService
            .receiveSubscriptionMessage(settings.queueName, settings.subscriptionName, {
                isPeekLock: true,
            }, (err1, lockedMessage) => {
                if (err1) {
                    if (err1 !== 'No messages to receive') {
                        throw err1;
                    }

                    setTimeout(() => this.getFromTheBus(callback), 1000);
                } else {
                    const {
                        body,
                        customProperties: {
                            notificationtype: notificationType,
                        },
                    } = lockedMessage;
                    const user = JSON.parse(body);

                    callback(user, notificationType);

                    this.serviceBusService.deleteMessage(lockedMessage, err2 => {
                        if (err2) {
                            log.error({
                                msg: 'message deletion failed: ',
                                obj: err2,
                            });
                        }

                        setTimeout(() => this.getFromTheBus(callback), 1);
                    });
                }
            });
    }
}

export default Subscriber;
