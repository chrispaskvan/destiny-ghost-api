/**
 * A module for publishing messages.
 *
 * @module Messenger
 * @summary Publish messages to topics accordingly.
 * @author Chris Paskvan
 * @requires azure
 * {@link https://docs.microsoft.com/en-us/azure/service-bus-messaging/service-bus-nodejs-how-to-use-topics-subscriptions}
 */
import { ServiceBusClient } from '@azure/service-bus';
import configuration from './config';
import log from './log';

const { serviceBus: settings } = configuration;

class Subscriber {
    /**
     * Azure Service Bus Client
     * @private
     */
    #serviceBusService;

    /**
     * Azure Service Bus Message Receiver
     * @private
     */
    #receiver;

    /**
     * @constructor
     */
    constructor() {
        // eslint-disable-next-line max-len
        this.#serviceBusService = new ServiceBusClient(settings.connectionString);
    }

    /**
     * Clean up resources.
     */
    async close() {
        try {
            if (this.#receiver) {
                await this.#receiver.close();
            }
        } finally {
            await this.#serviceBusService.close();
        }
    }

    /**
     * Receive streaming messages.
     * @param {function} callback
     */
    listen(callback) {
        this.#receiver = this.#serviceBusService
            .createReceiver(settings.queueName, settings.subscriptionName);

        // function to handle messages
        const myMessageHandler = async messageReceived => {
            const {
                body,
                applicationProperties: {
                    claimCheckNumber,
                    notificationType,
                    traceId,
                },
            } = messageReceived;
            const user = JSON.parse(body);

            log.info({
                claimCheckNumber,
                notificationType,
                traceId,
                ...user,
            }, 'Sending Message');
            callback(user, {
                claimCheckNumber,
                notificationType,
            });
        };

        // function to handle any errors
        const myErrorHandler = async error => {
            log.error(error);
        };

        // subscribe and specify the message and error handlers
        this.#receiver.subscribe({
            processMessage: myMessageHandler,
            processError: myErrorHandler,
        });
    }
}

const subscriber = new Subscriber();

export default subscriber;
