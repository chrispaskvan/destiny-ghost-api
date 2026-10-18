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
     * Give-up handlers still running. The worker's `failed` event does not
     * wait for them, so `close` has to, or one could reach Redis after the
     * shutdown that follows has closed it.
     * @type {Set<Promise<void>>}
     */
    #givingUp = new Set();

    /**
     * @constructor
     * @param {(body: *, options: { claimCheckNumber: string, notificationType: string }, job: import('bullmq').Job) => Promise<*>} callback -
     * handed the job itself too, for a handler that records progress on it
     * @param {string} [queueName] - The queue name to subscribe to.
     * @param {{
     *   concurrency?: number,
     *   maxStalledCount?: number,
     *   onGiveUp?: (body: *, options: { claimCheckNumber: string, notificationType: string }, job: import('bullmq').Job) => Promise<void>,
     * }} [options] -
     * Concurrency defaults to 5, which suits independent notification sends.
     * A queue whose jobs must be applied in the order they were enqueued
     * needs 1. `maxStalledCount` is how many times a job whose worker died
     * is picked up again before it is failed; BullMQ's default is 1.
     * `onGiveUp` is handed a job as `callback` is, once BullMQ has failed it
     * for good.
     */
    listen(
        callback,
        queueName = 'notifications',
        { concurrency = 5, maxStalledCount, onGiveUp } = {},
    ) {
        const worker = new Worker(
            queueName,
            async job => {
                try {
                    const {
                        body: user,
                        properties: { claimCheckNumber, notificationType },
                        traceId,
                    } = Subscriber.#unpack(job);

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
                ...(maxStalledCount !== undefined && { maxStalledCount }),
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

            /**
             * BullMQ stamps `finishedOn` only on a job it will not retry, so
             * this is its own decision rather than a guess at it from the
             * error. It also covers the failures no processor sees: a job
             * failed for stalling too often is failed here, by the worker
             * that next picks it up, without the callback running at all.
             */
            if (onGiveUp && job?.finishedOn) {
                this.#giveUp(onGiveUp, job);
            }
        });
        worker.on('error', err => {
            log.error({ error: err.message }, 'Worker error');
        });

        this.#workers.push(worker);

        log.info({ queueName }, 'Worker started for queue');
    }

    /**
     * Read a job's payload as the publisher wrote it: the parsed body, and
     * the properties a handler is given alongside it.
     * @param {import('bullmq').Job} job
     * @returns {{ body: *, properties: { claimCheckNumber: string, notificationType: string }, traceId?: string }}
     */
    static #unpack(job) {
        const {
            body,
            applicationProperties: { claimCheckNumber, notificationType, traceId },
        } = job.data;

        return {
            body: JSON.parse(body, safeReviver),
            properties: { claimCheckNumber, notificationType },
            traceId,
        };
    }

    /**
     * Run a give-up handler where `close` can wait for it, and where nothing
     * it throws - a payload too malformed to read included - escapes into
     * BullMQ's failure handling, which would report it without the job.
     * @param {(body: *, options: { claimCheckNumber: string, notificationType: string }, job: import('bullmq').Job) => Promise<void>} onGiveUp
     * @param {import('bullmq').Job} job
     * @returns {Promise<void>}
     */
    async #giveUp(onGiveUp, job) {
        const { promise, resolve } = Promise.withResolvers();

        this.#givingUp.add(promise);

        try {
            const { body, properties } = Subscriber.#unpack(job);

            await onGiveUp(body, properties, job);
        } catch (err) {
            log.error({ jobId: job.id, err }, 'Give-up handler failed');
        } finally {
            this.#givingUp.delete(promise);
            resolve(undefined);
        }
    }

    /**
     * Clean up resources. Each worker finishes its active jobs first, and a
     * worker that fails to close does not cut the others' drain short.
     */
    async close() {
        try {
            await closeAll(
                this.#workers.map(worker => worker.close()),
                'Subscriber failed to close',
            );
        } finally {
            // Waited for even when a worker fails to close: they never
            // reject, and what follows a close is Redis going away.
            await Promise.all(this.#givingUp);
        }
    }
}

const subscriber = new Subscriber();

export default subscriber;
