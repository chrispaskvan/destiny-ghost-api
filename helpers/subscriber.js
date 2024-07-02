/**
 * A module for publishing messages.
 *
 * @module Messenger
 * @summary Publish messages to topics accordingly.
 * @author Chris Paskvan
 */
import { Worker } from 'bullmq';
import cache from './cache';
import log from './log';

class Subscriber {
    /**
     * BullMQ Worker
     * @private
     */
    #workers = [];

    /**
     * @constructor
     * @param {string} queueName - The queue name to subscribe to.
     */
    async listen(callback, queueName = 'notifications') {
        const worker = new Worker(queueName, async ({ data }) => {
            const {
                body,
                applicationProperties: {
                    claimCheckNumber,
                    notificationType,
                    traceId,
                },
            } = data;
            const user = JSON.parse(body);

            log.info({
                claimCheckNumber,
                notificationType,
                traceId,
                ...user,
            }, 'Sending Message');

            await callback(user, {
                claimCheckNumber,
                notificationType,
            });
        }, {
            autorun: false,
            connection: cache,
        });

        this.#workers.push(worker);

        return await worker.run();
    }

    /**
     * Clean up resources.
     */
    async close() {
        await Promise.all(this.#workers.map(worker => worker.close()));
    }
}

const subscriber = new Subscriber();

export default subscriber;
