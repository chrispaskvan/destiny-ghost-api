import { beforeEach, describe, expect, it, vi } from 'vitest';
import Chance from 'chance';

const { mocks } = vi.hoisted(() => ({
    mocks: {
        add: vi.fn(async (_name, _data, { jobId }) => ({ id: jobId })),
        getJob: vi.fn(),
        queueClose: vi.fn(),
        queueEventsClose: vi.fn(),
        queueEventsOn: vi.fn(),
        constructorArgs: null,
    },
}));

vi.mock('bullmq', () => ({
    Queue: class {
        add(...args) {
            return mocks.add(...args);
        }
        getJob(...args) {
            return mocks.getJob(...args);
        }
        close() {
            return mocks.queueClose();
        }

        constructor(...args) {
            mocks.constructorArgs = args;
        }
    },
    QueueEvents: class {
        on(...args) {
            return mocks.queueEventsOn(...args);
        }
        close() {
            return mocks.queueEventsClose();
        }
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
        it('should queue a job named for the operation and recipient', async () => {
            const membershipId = chance.string({ length: 10, pool: '0123456789' });
            const result = await publisher.sendNotification(
                { membershipId, membershipType: 2, phoneNumber: '+12085550123' },
                {
                    notificationType: 'Xur',
                    claimCheckNumber: 'op1',
                    deduplicationId: 'Xur-2026-10-06-+12085550123',
                },
            );
            const [, , options] = mocks.add.mock.calls.at(-1);

            expect(options).toEqual({
                jobId: `op1-${membershipId}`,
                deduplication: { id: 'Xur-2026-10-06-+12085550123', ttl: 604_800_000 },
            });
            expect(options.jobId).not.toContain(':');
            expect(result).toEqual({ deduplicated: false });
        });

        it('should report a job BullMQ deduplicated into another', async () => {
            mocks.add.mockResolvedValueOnce({ id: 'op0-4611686018' });

            const result = await publisher.sendNotification(
                { membershipId: '4611686018', membershipType: 2, phoneNumber: '+12085550123' },
                {
                    notificationType: 'Xur',
                    claimCheckNumber: 'op1',
                    deduplicationId: 'Xur-2026-10-06-+12085550123',
                },
            );

            expect(result).toEqual({ deduplicated: true });
        });

        it('should require a deduplication id', async () => {
            await expect(
                publisher.sendNotification(
                    { membershipId: '1', membershipType: 2, phoneNumber: '+12085550123' },
                    { notificationType: 'Xur', claimCheckNumber: 'op1' },
                ),
            ).rejects.toThrow('deduplication id is required');
            expect(mocks.add).not.toHaveBeenCalled();
        });

        /**
         * The single-recipient path hands this method whatever
         * `getUserByPhoneNumber` returned, which is the entire Cosmos
         * document. A BullMQ job outlives the request that made it, so what
         * does not go in cannot be read back out of Redis a week later.
         */
        it('should queue the identifiers alone, not the document it was handed', async () => {
            const accessToken = chance.hash({ length: 40 });
            const code = chance.string({ length: 6, pool: '0123456789' });
            const membershipId = chance.guid();
            const membershipType = chance.integer({ min: 1, max: 2 });
            const phoneNumber = '+12085550123';

            await publisher.sendNotification(
                {
                    membershipId,
                    membershipType,
                    phoneNumber,
                    emailAddress: chance.email(),
                    firstName: chance.first(),
                    bungie: { access_token: accessToken, refresh_token: chance.hash() },
                    membership: { tokens: { code, blob: chance.hash() } },
                },
                { notificationType: 'Xur', claimCheckNumber: '11', deduplicationId: '11-1' },
            );

            const [, message] = mocks.add.mock.calls.at(-1);

            expect(JSON.parse(message.body)).toEqual({
                membershipId,
                membershipType,
                phoneNumber,
            });
            expect(message.body).not.toContain(accessToken);
            expect(message.body).not.toContain(code);
        });
    });

    describe('close', () => {
        it.each([
            ['Queue', mocks.queueClose, mocks.queueEventsClose],
            ['QueueEvents', mocks.queueEventsClose, mocks.queueClose],
        ])('should not resolve until its %s has closed', async (_label, pending, settled) => {
            const closing = Promise.withResolvers();
            let closed = false;

            pending.mockReturnValue(closing.promise);
            settled.mockResolvedValue(undefined);

            const close = publisher.close().then(() => {
                closed = true;
            });

            await new Promise(resolve => setImmediate(resolve));
            expect(mocks.queueClose).toHaveBeenCalledOnce();
            expect(mocks.queueEventsClose).toHaveBeenCalledOnce();
            expect(closed).toBe(false);

            closing.resolve();
            await close;

            expect(closed).toBe(true);
        });

        it('should keep waiting for the queue when its queue events fail to close', async () => {
            const closing = Promise.withResolvers();
            const err = new Error('close failed');
            let settled = false;

            mocks.queueEventsClose.mockRejectedValue(err);
            mocks.queueClose.mockReturnValue(closing.promise);

            const close = publisher.close().catch(reason => {
                settled = true;
                return reason;
            });

            await new Promise(resolve => setImmediate(resolve));
            expect(settled).toBe(false);

            closing.resolve();
            const reason = await close;

            expect(reason).toBeInstanceOf(AggregateError);
            expect(reason.errors).toEqual([err]);
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

        it('should not throw when getJob rejects', async () => {
            mocks.getJob.mockRejectedValue(new Error('Redis connection lost'));

            await expect(
                failedHandler({ jobId: 'job-1', failedReason: 'Some error' }),
            ).resolves.toBeUndefined();

            expect(applicationInsights.trackMetric).not.toHaveBeenCalled();
        });

        it('should not emit metric when opts is missing', async () => {
            mocks.getJob.mockResolvedValue({
                attemptsMade: 3,
                opts: undefined,
            });

            await expect(
                failedHandler({ jobId: 'job-1', failedReason: 'Some error' }),
            ).resolves.toBeUndefined();

            expect(applicationInsights.trackMetric).not.toHaveBeenCalled();
        });
    });
});
