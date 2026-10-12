import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Mirrors twilio/consent.queue.spec.js: replace the BullMQ Queue with a plain
 * class that records what it was constructed and called with, so the queue's
 * configuration is asserted without a Redis connection.
 */
const { mocks } = vi.hoisted(() => ({
    mocks: {
        add: vi.fn(),
        getJob: vi.fn(),
        constructorArgs: null,
    },
}));

vi.mock('bullmq', () => ({
    Queue: class {
        constructor(...args) {
            mocks.constructorArgs = args;
        }
        add(...args) {
            return mocks.add(...args);
        }
        getJob(...args) {
            return mocks.getJob(...args);
        }
    },
}));

vi.mock('../helpers/jobs.js', () => ({
    default: { host: 'localhost', port: 6379 },
}));

vi.mock('../helpers/async-context.js', () => ({
    default: {
        getStore: () => new Map([['logger', { bindings: () => ({ traceId: 'trace-1' }) }]]),
    },
}));

import {
    BroadcastConflictError,
    enqueueBroadcast,
    getBroadcast,
    QUEUE_NAME,
} from './broadcast.queue.js';

describe('broadcast queue', () => {
    beforeEach(() => {
        mocks.add.mockReset();
        mocks.getJob.mockReset();
    });

    it('should build the queue on the shared jobs connection', () => {
        const [name, options] = mocks.constructorArgs;

        expect(name).toBe(QUEUE_NAME);
        expect(options.connection).toEqual({ host: 'localhost', port: 6379 });
    });

    it('should retry a broadcast and keep it as long as its claim check', () => {
        const [, { defaultJobOptions }] = mocks.constructorArgs;

        expect(defaultJobOptions.attempts).toBe(5);
        expect(defaultJobOptions.removeOnComplete).toEqual({ age: 86_400 });
        expect(defaultJobOptions.removeOnFail).toEqual({ age: 604_800 });
    });

    describe('when the operation is already recorded', () => {
        const recordedAs = notificationType => ({
            id: 'op-1',
            data: { applicationProperties: { claimCheckNumber: 'op-1', notificationType } },
        });

        it('should leave a broadcast of the same thing as it is', async () => {
            const recorded = recordedAs('Xur');

            mocks.getJob.mockResolvedValue(recorded);

            await expect(
                enqueueBroadcast({
                    operationId: 'op-1',
                    notificationType: 'Xur',
                    weeklyReset: '2026-10-06',
                }),
            ).resolves.toBe(recorded);
            expect(mocks.add).not.toHaveBeenCalled();
        });

        it('should refuse to record it as a broadcast of something else', async () => {
            mocks.getJob.mockResolvedValue(recordedAs('Banshee-44'));

            await expect(
                enqueueBroadcast({
                    operationId: 'op-1',
                    notificationType: 'Xur',
                    weeklyReset: '2026-10-06',
                }),
            ).rejects.toBeInstanceOf(BroadcastConflictError);
            expect(mocks.add).not.toHaveBeenCalled();
        });
    });

    it('should queue the broadcast under its operation id, in the envelope the worker reads', async () => {
        await enqueueBroadcast({
            operationId: 'op-1',
            notificationType: 'Xur',
            weeklyReset: '2026-10-06',
        });

        expect(mocks.add).toHaveBeenCalledExactlyOnceWith(
            'broadcast',
            {
                body: JSON.stringify({ weeklyReset: '2026-10-06' }),
                applicationProperties: {
                    claimCheckNumber: 'op-1',
                    notificationType: 'Xur',
                    traceId: 'trace-1',
                },
            },
            { jobId: 'op-1' },
        );
    });

    describe('getBroadcast', () => {
        it('should report nothing for a broadcast that does not exist', async () => {
            mocks.getJob.mockResolvedValue(undefined);

            await expect(getBroadcast('op-1')).resolves.toBeUndefined();
        });

        it('should report a broadcast that has not started a page yet', async () => {
            mocks.getJob.mockResolvedValue({
                data: {},
                attemptsMade: 0,
                failedReason: '',
                getState: async () => 'waiting',
            });

            await expect(getBroadcast('op-1')).resolves.toEqual({
                state: 'waiting',
                queued: 0,
                duplicates: 0,
                done: false,
                attemptsMade: 0,
                failedReason: undefined,
            });
        });

        it('should report the progress saved on the job, and why it last failed', async () => {
            mocks.getJob.mockResolvedValue({
                data: {
                    progress: { cursor: 'page-3', queued: 180, duplicates: 20, done: false },
                },
                attemptsMade: 2,
                failedReason: 'Subscribers could not be read.',
                getState: async () => 'delayed',
            });

            const broadcast = await getBroadcast('op-1');

            expect(broadcast).toEqual({
                state: 'delayed',
                queued: 180,
                duplicates: 20,
                done: false,
                attemptsMade: 2,
                failedReason: 'Subscribers could not be read.',
            });
            expect(broadcast).not.toHaveProperty('cursor');
        });

        /**
         * A worker that stalled and lost the job can still write progress
         * when it wakes, after the worker that took over has finished, so
         * the saved progress of a completed broadcast may be older than its
         * end. Only the lock holder can complete a job and set its return
         * value, so that is what a completed broadcast reports.
         */
        it('should report a completed broadcast from its return value, not progress a stale worker left', async () => {
            mocks.getJob.mockResolvedValue({
                data: {
                    progress: { cursor: 'page-2', queued: 100, duplicates: 0, done: false },
                },
                returnvalue: { queued: 240, duplicates: 3, done: true },
                attemptsMade: 0,
                failedReason: '',
                getState: async () => 'completed',
            });

            await expect(getBroadcast('op-1')).resolves.toMatchObject({
                state: 'completed',
                queued: 240,
                duplicates: 3,
                done: true,
            });
        });
    });
});
