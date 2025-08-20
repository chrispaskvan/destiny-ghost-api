/**
 * A module for publishing messages.
 *
 * @module Messenger
 * @summary Publish messages to topics accordingly.
 * @author Chris Paskvan
 */
import { Worker } from 'bullmq';
import client from './jobs.js';
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
    listen(callback, queueName = 'notifications') {
        const worker = new Worker(queueName, async job => {
            try {
                const { data } = job;
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
                    jobId: job.id,
                    claimCheckNumber,
                    notificationType,
                    traceId,
                    ...user,
            }, 'Sending message');

                await callback(user, {
                    claimCheckNumber,
                    notificationType,
                });

                log.info({
                    jobId: job.id,
                    claimCheckNumber,
                    notificationType,
                }, 'Message processed successfully');
            } catch (error) {
                log.error({
                    jobId: job.id,
                    error: error.message,
                    stack: error.stack,
                }, 'Failed to process message');
                throw error; // Re-throw to let BullMQ handle retries
            }
        }, {
            connection: client,
            concurrency: 5, // Process up to 5 jobs concurrently
        });

        // Handle worker events
        worker.on('completed', (job) => {
            log.info({ jobId: job.id }, 'Job completed');
        });
        worker.on('failed', (job, err) => {
            log.error({ 
                jobId: job?.id, 
                error: err.message,
                stack: err.stack 
            }, 'Job failed');
        });
        worker.on('error', (err) => {
            log.error({ error: err.message }, 'Worker error');
        });

        this.#workers.push(worker);

        log.info({ queueName }, 'Worker started for queue');
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
