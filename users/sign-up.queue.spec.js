import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Mirrors twilio/consent.queue.spec.js: plain stand-ins for BullMQ record
 * what the queue was built and called with, with no Redis connection.
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

import { enqueueResend, enqueueSignUp, QUEUE_NAME } from './sign-up.queue.js';

describe('sign-up queue', () => {
    beforeEach(() => {
        mocks.add.mockClear();
    });

    it('should build the queue on the shared jobs connection', () => {
        const [name, options] = mocks.constructorArgs;

        expect(name).toBe(QUEUE_NAME);
        expect(name).toBe('sign-up');
        expect(options.connection).toEqual({ host: 'localhost', port: 6379 });
    });

    it('should try a job once, since a retry would send and bill again', () => {
        const [, { defaultJobOptions }] = mocks.constructorArgs;

        expect(defaultJobOptions.attempts).toBe(1);
        expect(defaultJobOptions).not.toHaveProperty('backoff');
    });

    it('should not keep the submitted contact longer than it needs to', () => {
        const [, { defaultJobOptions }] = mocks.constructorArgs;

        expect(defaultJobOptions.removeOnComplete).toBe(true);
        expect(defaultJobOptions.removeOnFail).toEqual({ age: 86_400 });
    });

    it('should queue a sign-up in the envelope the subscriber reads', async () => {
        const contact = {
            emailAddress: 'ada@example.com',
            firstName: 'Ada',
            lastName: 'Lovelace',
            phoneNumber: '+12085550123',
        };

        await enqueueSignUp({ displayName: 'Ada', membershipType: 2, contact, extra: 'x' });

        expect(mocks.add).toHaveBeenCalledExactlyOnceWith('sign-up', {
            body: JSON.stringify({ displayName: 'Ada', membershipType: 2, contact }),
            applicationProperties: { traceId: 'trace-1' },
        });
    });

    it('should queue a resend in the same envelope', async () => {
        await enqueueResend({ displayName: 'Ada', membershipType: 2, channel: 'email' });

        expect(mocks.add).toHaveBeenCalledExactlyOnceWith('resend', {
            body: JSON.stringify({ displayName: 'Ada', membershipType: 2, channel: 'email' }),
            applicationProperties: { traceId: 'trace-1' },
        });
    });
});
