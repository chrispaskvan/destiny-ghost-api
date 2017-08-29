/**
 * A module for publishing messages.
 *
 * @module Messenger
 * @summary Publish messages to topics accordingly.
 * @author Chris Paskvan
 * @requires azure
 */
'use strict';
var azure = require('azure'),
    log = require('./log'),
    settings = require('../settings/serviceBus.json'),
    Q = require('q');

let createTopicPromise;
let wasTopicCreated;
/**
 * Publisher of Messages
 */
class Publisher {
    /**
     * @constructor
     */
    constructor() {
        const retryOperations = new azure.ExponentialRetryPolicyFilter();

        this.queueName = settings.queueName;
        this.serviceBusService = azure.createServiceBusService(settings.connectionString)
            .withFilter(retryOperations);
    }

    /**
     * Create Topic for Messages
     * @returns {Request|Promise.<T>|*}
     */
    static createTopic(queueName, serviceBusService) {
        const createTopicIfNotExists = Q.nbind(serviceBusService.createTopicIfNotExists, serviceBusService);

        if (wasTopicCreated) {
            return Promise.resolve(true);
        }

        if (createTopicPromise) {
            return createTopicPromise;
        }

        createTopicPromise = createTopicIfNotExists(queueName);
        createTopicPromise
            .then(topicCreated => {
                wasTopicCreated = !(!topicCreated[0] && topicCreated[1].statusCode !== 409);
                log.info('topic created', topicCreated);
            })
            .finally(() => createTopicPromise = undefined);

        return createTopicPromise;
    }

    static throwIfMissingNotificationType() {
        throw new Error('notification type is required');
    }

    sendNotification(user, notificationType = this.constructor.throwIfMissingNotificationType()) {
        const sendTopicMessage = Q.nbind(this.serviceBusService.sendTopicMessage, this.serviceBusService);
        const message = {
            body: JSON.stringify(user),
            customProperties: {
                notificationType
            }
        };

        return this.constructor.createTopic(this.queueName, this.serviceBusService)
            .then(success => {
                if (!success) {
                    return false;
                }

                return sendTopicMessage(this.queueName, message)
                    .then((response) => {
                        return response.isSuccessful;
                    });
            });
    }
}

module.exports = Publisher;
