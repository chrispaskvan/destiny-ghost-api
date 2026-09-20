import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * Mirrors helpers/publisher.spec.js: replace the BullMQ classes with plain
 * ones that record what they were constructed and called with, so the queue's
 * configuration is asserted without a Redis connection.
 */
const { mocks } = vi.hoisted(() => ({
    mocks: {
        add: vi.fn().mockResolvedValue({ id: 'job-1' }),
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
    },
}));

vi.mock('../helpers/jobs.js', () => ({
    default: { host: 'localhost', port: 6379 },
}));

const bindings = vi.fn(() => ({ traceId: 'trace-1' }));

vi.mock('../helpers/async-context.js', () => ({
    default: { getStore: () => new Map([['logger', { bindings }]]) },
}));

import { enqueueConsentChange, QUEUE_NAME } from './consent.queue.js';

describe('consent queue', () => {
    beforeEach(() => {
        mocks.add.mockClear();
    });

    it('should build the queue on the shared jobs connection', () => {
        const [name, options] = mocks.constructorArgs;

        expect(name).toBe(QUEUE_NAME);
        expect(options.connection).toEqual({ host: 'localhost', port: 6379 });
    });

    it('should retry more patiently than a notification and keep failures for a week', () => {
        const [, { defaultJobOptions }] = mocks.constructorArgs;

        /**
         * The sender was told the change applied before this job ran, so a
         * failure has to survive long enough for an operator to see it.
         */
        expect(defaultJobOptions.attempts).toBe(5);
        expect(defaultJobOptions.backoff).toEqual({ type: 'exponential', delay: 1000 });
        expect(defaultJobOptions.removeOnFail.age).toBe(604_800);
    });

    it('should carry the intent and its arrival time in the job payload', async () => {
        await enqueueConsentChange({
            phoneNumber: '+15005550006',
            isSubscribed: false,
            receivedAt: 1_700_000_000_000,
        });

        const [name, payload] = mocks.add.mock.calls[0];

        expect(name).toBe('consent');
        expect(JSON.parse(payload.body)).toEqual({
            phoneNumber: '+15005550006',
            isSubscribed: false,
            receivedAt: 1_700_000_000_000,
        });
        expect(payload.applicationProperties).toEqual({ traceId: 'trace-1' });
    });

    it('should not deduplicate, so a reversal is never collapsed into its predecessor', async () => {
        const consent = { phoneNumber: '+15005550006', receivedAt: 1_700_000_000_000 };

        await enqueueConsentChange({ ...consent, isSubscribed: false });
        await enqueueConsentChange({ ...consent, isSubscribed: true });

        /**
         * `publisher.js` dedupes notifications on type + phone number. Doing
         * that here would drop a START following a STOP from the same number,
         * which is the opposite of what the guardian asked for.
         */
        for (const [, , options] of mocks.add.mock.calls) {
            expect(options?.deduplication).toBeUndefined();
        }
        expect(mocks.add).toHaveBeenCalledTimes(2);
    });
});
