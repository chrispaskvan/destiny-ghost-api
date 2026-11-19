import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Mirrors consent.queue.spec.js: the BullMQ classes are replaced with plain
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

import { DEDUPLICATION_TTL_MS, enqueueMms, QUEUE_NAME } from './mms.queue.js';

const mms = {
    messageSid: `MM${'1'.repeat(32)}`,
    from: '+15005550006',
    media: [{ contentType: 'image/jpeg', url: 'https://api.twilio.com/media/ME1' }],
};

describe('MMS queue', () => {
    beforeEach(() => {
        mocks.add.mockClear();
    });

    it('should build the queue on the shared jobs connection', () => {
        const [name, options] = mocks.constructorArgs;

        expect(name).toBe(QUEUE_NAME);
        expect(options.connection).toEqual({ host: 'localhost', port: 6379 });
    });

    it('should retry a few times and keep failures for a week', () => {
        const [, { defaultJobOptions }] = mocks.constructorArgs;

        expect(defaultJobOptions.attempts).toBe(3);
        expect(defaultJobOptions.backoff).toEqual({ type: 'exponential', delay: 5000 });
        expect(defaultJobOptions.removeOnFail.age).toBe(604_800);
    });

    it('should deduplicate on the message SID, so a redelivered webhook adds nothing', async () => {
        await enqueueMms(mms);

        const [, , options] = mocks.add.mock.calls[0];

        expect(options.deduplication).toEqual({ id: mms.messageSid, ttl: DEDUPLICATION_TTL_MS });
    });

    it('should outlast Twilio redelivering the webhook', () => {
        expect(DEDUPLICATION_TTL_MS).toBeGreaterThanOrEqual(86_400_000);
    });

    it('should queue the message in the envelope the subscriber reads, carrying its trace', async () => {
        await expect(enqueueMms(mms)).resolves.toEqual({ id: 'job-1' });

        const [name, data] = mocks.add.mock.calls[0];

        expect(name).toBe('mms');
        expect(JSON.parse(data.body)).toEqual(mms);
        expect(data.applicationProperties).toEqual({ traceId: 'trace-1' });
    });

    it('should queue only the fields it is given, so no credential reaches Redis', async () => {
        await enqueueMms({ ...mms, authToken: 'secret' });

        const [, data] = mocks.add.mock.calls[0];

        expect(data.body).not.toContain('secret');
    });
});
