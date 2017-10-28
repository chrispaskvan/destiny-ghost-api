/**
 * A module for publishing messages.
 *
 * @module Messenger
 * @summary Publish messages to topics accordingly.
 * @author Chris Paskvan
 * @requires azure
 * {@link https://docs.microsoft.com/en-us/azure/service-bus-messaging/service-bus-nodejs-how-to-use-topics-subscriptions}
 */
'use strict';
var azure = require('azure'),
    log = require('./log'),
    settings = require('../settings/serviceBus.json'),
    Q = require('q');

function getFromTheBus(serviceBusService) {
    const deleteMessage = Q.nbind(serviceBusService.deleteMessage, serviceBusService);
    const receiveSubscriptionMessage = Q.nbind(serviceBusService.receiveSubscriptionMessage, serviceBusService);

    receiveSubscriptionMessage(settings.queueName, settings.subscriptionName, {
        isPeekLock: true,
        timeoutIntervalInS: 5
    })
        .then((lockedMessage) => {
            return deleteMessage(lockedMessage[0])
                .then((response) => response.isSuccessful);
        })
        .catch(err => {
            if (err !== 'No messages to receive') {
                log.error(err);
            }
        })
        .fin(() => {
            setTimeout(getFromTheBus(serviceBusService), 1000);
        });
}

class Subscriber {
    /**
     * @constructor
     */
    constructor() {
        const retryOperations = new azure.ExponentialRetryPolicyFilter();
        const serviceBusService = azure.createServiceBusService(settings.connectionString)
            .withFilter(retryOperations);

        serviceBusService.createSubscription(settings.queueName, settings.subscriptionName, err => {
            if (!err || (err && err.code === '409')) {
                getFromTheBus(serviceBusService);
            } else {
                if (err) {
                    log.error(err);
                }
            }
        });
    }
}

module.exports = Subscriber;
