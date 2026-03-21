import {
    describe, expect, it, vi, beforeEach,
} from 'vitest';
import Chance from 'chance';

const { mocks } = vi.hoisted(() => ({
    mocks: {
        add: vi.fn().mockResolvedValue('some-job'),
        getJob: vi.fn(),
        queueEventsOn: vi.fn(),
        constructorArgs: null,
    },
}));

vi.mock('bullmq', () => ({
    Queue: class {
        add(...args) { return mocks.add(...args); }
        getJob(...args) { return mocks.getJob(...args); }

        constructor(...args) {
            mocks.constructorArgs = args;
        }
    },
    QueueEvents: class {
        on(...args) { return mocks.queueEventsOn(...args); }
    },
}));

vi.mock('./application-insights.js', () => ({
    default: { trackMetric: vi.fn() },
}));

import publisher from './publisher.js';
import applicationInsights from './application-insights.js';

const chance = new Chance();

beforeEach(() => {
    vi.clearAllMocks();
});

describe('Publisher', () => {
    describe('Queue configuration', () => {
        it('should configure Queue with defaultJobOptions for retries and cleanup', () => {
            const [, options] = mocks.constructorArgs;

            expect(options.defaultJobOptions).toEqual({
                attempts: 3,
                backoff: {
                    type: 'exponential',
                    delay: 5000,
                },
                removeOnComplete: {
                    age: 86_400,
                    count: 1000,
                },
                removeOnFail: {
                    age: 604_800,
                    count: 500,
                },
            });
        });
    });

    describe('sendNotification', () => {
        it('should send a notification to a user', async () => {
            const user = {
                name: chance.name(),
                email: chance.email(),
            };
            const result = await publisher.sendNotification(user, { notificationType: 'Xur', claimCheckNumber: '11' });

            expect(result).toBe('some-job');
        });
    });

    describe('failed event handler', () => {
        // Extract the 'failed' event handler registered during module init (Publisher constructor).
        // This must happen before clearAllMocks wipes the call records.
        const failedCall = mocks.queueEventsOn.mock.calls.find(([event]) => event === 'failed');
        const failedHandler = failedCall?.[1];

        it('should register a failed event handler', () => {
            expect(failedHandler).toBeTypeOf('function');
        });

        it('should emit metric when job exhausts all retries', async () => {
            mocks.getJob.mockResolvedValue({
                attemptsMade: 3,
                opts: { attempts: 3 },
            });

            await failedHandler({ jobId: 'job-1', failedReason: 'Some transient error' });

            expect(applicationInsights.trackMetric).toHaveBeenCalledWith({
                name: 'notification-job-exhausted',
                value: 1,
            });
        });

        it('should not emit metric when job has retries remaining', async () => {
            mocks.getJob.mockResolvedValue({
                attemptsMade: 1,
                opts: { attempts: 3 },
            });

            await failedHandler({ jobId: 'job-1', failedReason: 'Some transient error' });

            expect(applicationInsights.trackMetric).not.toHaveBeenCalled();
        });

        it('should not emit metric when job is not found', async () => {
            mocks.getJob.mockResolvedValue(null);

            await failedHandler({ jobId: 'job-1', failedReason: 'Some error' });

            expect(applicationInsights.trackMetric).not.toHaveBeenCalled();
        });
    });
});
