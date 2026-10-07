/**
 * A module for publishing messages.
 *
 * @module Messenger
 * @summary Publish messages to topics accordingly.
 * @author Chris Paskvan
 */
// @ts-check
import { Worker } from 'bullmq';
import closeAll from './close-all.js';
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
     * @param {(body: *, options: { claimCheckNumber: string, notificationType: string }, job: import('bullmq').Job) => Promise<*>} callback -
     * handed the job itself too, for a handler that records progress on it
     * @param {string} [queueName] - The queue name to subscribe to.
     * @param {{ concurrency?: number, maxStalledCount?: number }} [options] -
     * Concurrency defaults to 5, which suits independent notification sends.
     * A queue whose jobs must be applied in the order they were enqueued
     * needs 1. `maxStalledCount` is how many times a job whose worker died
     * is picked up again before it is failed; BullMQ's default is 1.
     */
    listen(callback, queueName = 'notifications', { concurrency = 5, maxStalledCount } = {}) {
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

                    const result = await callback(
                        user,
                        {
                            claimCheckNumber,
                            notificationType,
                        },
                        job,
                    );

                    log.info(
                        {
                            jobId: job.id,
                            queueName,
                            claimCheckNumber,
                            notificationType,
                        },
                        'Job processed successfully',
                    );

                    return result;
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
                ...(maxStalledCount && { maxStalledCount }),
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
     * Clean up resources. Each worker finishes its active jobs first, and a
     * worker that fails to close does not cut the others' drain short.
     */
    async close() {
        await closeAll(
            this.#workers.map(worker => worker.close()),
            'Subscriber failed to close',
        );
    }
}

const subscriber = new Subscriber();

export default subscriber;
