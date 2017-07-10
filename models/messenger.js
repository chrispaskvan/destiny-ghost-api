/**
 * A module for publishing messages.
 *
 * @module Messenger
 * @summary Publish messages to topics accordingly.
 * @author Chris Paskvan
 * @requires azure
 */
'use strict';
var _ = require('underscore'),
    azure = require('azure'),
    fs = require('fs'),
    Q = require('q');
/**
 * @param {string} serviceBusSettingsFullPath - Full path to the JSON Bitly settings file.
 * @constructor
 */
var Messenger = function (serviceBusSettingsFullPath) {
    var queueName = 'gjallarhorn';
    var subscriptionName = 'iron';
    /**
     * @member {Object}
     * @type {{accessToken: string}} settings
     */
    var settings = JSON.parse(fs.readFileSync(serviceBusSettingsFullPath || './settings/serviceBus.json'));
    var retryOperations = new azure.ExponentialRetryPolicyFilter();
    var serviceBusService = azure.createServiceBusService(settings.connectionString)
        .withFilter(retryOperations);

    var sendMessages = function (messages) {
        var promises = [];
        var sendTopicMessage = Q.nbind(serviceBusService.sendTopicMessage, serviceBusService);

        return getFromTheBus();

        return createTopic()
            .then(function () {
                _.each(messages, function (message) {
                    promises.push(sendTopicMessage(queueName, message)
                        .then(function () {
                            console.log('Message sent: ' + message);
                        }));
                });

                return Q.all(promises)
                    .then(function () {
                        return;
                    });
            });
    };

    function createSubscriptions() {
        var createSubscription = Q.nbind(serviceBusService.createSubscription, serviceBusService);

        return createSubscription(queueName, subscriptionName)
            .then(function (result, response) {
                console.log(result);
                console.log(response);
            })
            .fail(function (err) {
                console.log(err);
            });
    }

    function subscribe() {
        var deleteMessage = Q.nbind(serviceBusService.deleteMessage, serviceBusService);
        var promises = [];
        var receiveSubscriptionMessage = Q.nbind(serviceBusService.receiveSubscriptionMessage, serviceBusService);

        return receiveSubscriptionMessage(queueName, subscriptionName, { isPeekLock: true })
            .then(function (lockedMessages) {
                console.log(lockedMessages);
                _.each(lockedMessages, function (lockedMessage) {
                    promises.push(deleteMessage(lockedMessage));
                });

                return Q.all(promises)
                    .then(function () {
                        return;
                    });
            });
    }

    function createTopic() {
        var createTopicIfNotExists = Q.nbind(serviceBusService.createTopicIfNotExists, serviceBusService);

        return createTopicIfNotExists(queueName)
            .then(function (topicCreated, response) {
                console.log(topicCreated);
                console.log(response);
                createSubscriptions();
            });
    }

    function getFromTheBus() {
        var deleteMessage = Q.nbind(serviceBusService.deleteMessage, serviceBusService);
        var promises = [];
        var receiveSubscriptionMessage = Q.nbind(serviceBusService.receiveSubscriptionMessage, serviceBusService);

        try {
            return receiveSubscriptionMessage(queueName, subscriptionName, { isPeekLock: true, timeoutIntervalInS: 5 })
                .then(function (lockedMessages) {
                    _.each(lockedMessages, function (lockedMessage) {
                        promises.push(deleteMessage(lockedMessage)
                            .then(function () {
                                console.log('eee');
                            }));
                    });

                    return Q.all(promises)
                        .then(function () {
                            getFromTheBus();
                        });
                });

        } catch (e) {
            setTimeout(getFromTheBus, 1000);
        }
    }

    return {
        sendMessages: sendMessages
    };
};
module.exports = Messenger;
