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

import { enqueueBroadcast, getBroadcast, QUEUE_NAME } from './broadcast.queue.js';

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
                failedReason: 'Redis unavailable',
                getState: async () => 'delayed',
            });

            const broadcast = await getBroadcast('op-1');

            expect(broadcast).toEqual({
                state: 'delayed',
                queued: 180,
                duplicates: 20,
                done: false,
                attemptsMade: 2,
                failedReason: 'Redis unavailable',
            });
            expect(broadcast).not.toHaveProperty('cursor');
        });
    });
});
