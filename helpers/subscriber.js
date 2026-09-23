/**
 * A module for publishing messages.
 *
 * @module Messenger
 * @summary Publish messages to topics accordingly.
 * @author Chris Paskvan
 */
// @ts-check
import { Worker } from 'bullmq';
import client from './jobs.js';
import log from './log.js';
import safeReviver from './safe-reviver.js';

class Subscriber {
    /**
     * BullMQ Worker
     * @type {import('bullmq').Worker[]}
     */
    #workers = [];

    /**
     * @constructor
     * @param {(user: *, options: { claimCheckNumber: string, notificationType: string }) => Promise<void>} callback
     * @param {string} [queueName] - The queue name to subscribe to.
     * @param {{ concurrency?: number }} [options] - Concurrency defaults to 5,
     * which suits independent notification sends. A queue whose jobs must be
     * applied in the order they were enqueued needs 1.
     */
    listen(callback, queueName = 'notifications', { concurrency = 5 } = {}) {
        const worker = new Worker(
            queueName,
            async job => {
                try {
                    const { data } = job;
                    const {
                        body,
                        applicationProperties: { claimCheckNumber, notificationType, traceId },
                    } = data;
                    const user = JSON.parse(body, safeReviver);

                    /**
                     * The payload is deliberately absent. Spreading it here
                     * put whatever the publisher had queued into the log
                     * event, which for a single-recipient notification was the
                     * whole user document. `helpers/publisher.js` now queues
                     * identifiers only, but a job enqueued before that change
                     * can still be waiting in Redis, so this stays narrow
                     * rather than trusting what it is handed.
                     */
                    log.info(
                        {
                            jobId: job.id,
                            queueName,
                            claimCheckNumber,
                            notificationType,
                            traceId,
                        },
                        'Processing job',
                    );

                    await callback(user, {
                        claimCheckNumber,
                        notificationType,
                    });

                    log.info(
                        {
                            jobId: job.id,
                            queueName,
                            claimCheckNumber,
                            notificationType,
                        },
                        'Job processed successfully',
                    );
                } catch (err) {
                    log.error(
                        {
                            jobId: job.id,
                            error: err instanceof Error ? err.message : String(err),
                            stack: err instanceof Error ? err.stack : undefined,
                        },
                        'Failed to process job',
                    );
                    throw err; // Re-throw to let BullMQ handle retries
                }
            },
            {
                connection: client,
                concurrency,
            },
        );

        // Handle worker events
        worker.on('completed', job => {
            log.info({ jobId: job.id }, 'Job completed');
        });
        worker.on('failed', (job, err) => {
            log.error(
                {
                    jobId: job?.id,
                    error: err.message,
                    stack: err.stack,
                },
                'Job failed',
            );
        });
        worker.on('error', err => {
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
