import { beforeEach, describe, expect, it, vi } from 'vitest';
import mockTwilioCreateMessageResponse from '../mocks/twilioCreateMessageResponse.json';
import Notifications, { CLOCK_SKEW_MS, RECONCILE_AFTER_MS } from './notification.service.js';
import SendOutcomeUnknownError from './send-outcome-unknown.error.js';
import DispatchRecord from '../helpers/dispatch-record.js';
import { withRetry, isTransientError } from '../helpers/retry.js';

vi.mock('../helpers/retry.js', () => ({
    withRetry: vi.fn(fn => fn()),
    isTransientError: vi.fn(),
}));
/**
 * The record kept in memory, so the cases below can drive a send through each
 * state and assert what the next attempt does with it.
 */
const records = vi.hoisted(() => new Map());

vi.mock('../helpers/dispatch-record.js', () => ({
    default: {
        read: vi.fn(async (claimCheckNumber, phoneNumber) =>
            structuredClone(records.get(`${claimCheckNumber}:${phoneNumber}`) ?? null),
        ),
        begin: vi.fn(async (claimCheckNumber, phoneNumber, body) => {
            records.set(`${claimCheckNumber}:${phoneNumber}`, {
                state: 'attempting',
                at: Date.now(),
                body,
            });
        }),
        accept: vi.fn(async (claimCheckNumber, phoneNumber, sid) => {
            records.set(`${claimCheckNumber}:${phoneNumber}`, { state: 'accepted', sid });
        }),
        forget: vi.fn(async (claimCheckNumber, phoneNumber) => {
            records.delete(`${claimCheckNumber}:${phoneNumber}`);
        }),
    },
}));
vi.mock('../helpers/twilio-rate-limiter.js', () => ({
    default: { schedule: vi.fn(fn => fn()) },
}));

const client = {
    messages: {
        create: vi.fn(() => Promise.resolve(mockTwilioCreateMessageResponse)),
    },
};
const limiter = {
    schedule: vi.fn(fn => fn()),
};

let notificationService;

beforeEach(() => {
    vi.clearAllMocks();
    records.clear();
    client.messages.create.mockResolvedValue(mockTwilioCreateMessageResponse);
    limiter.schedule.mockImplementation(fn => fn());
    notificationService = new Notifications({ client, limiter });
});

describe('Notifications', () => {
    it('schedules the Twilio send through the injected rate limiter', async () => {
        await notificationService.sendMessage('Aegis of the Reef', '+11111111111');

        expect(limiter.schedule).toHaveBeenCalledTimes(1);
        expect(client.messages.create).toHaveBeenCalledTimes(1);
    });

    it('does not call Twilio directly if the limiter never invokes the scheduled function', async () => {
        limiter.schedule.mockImplementation(() => Promise.resolve('deferred'));

        const result = await notificationService.sendMessage('Aegis of the Reef', '+11111111111');

        expect(client.messages.create).not.toHaveBeenCalled();
        expect(result).toBe('deferred');
    });

    describe('the consent guard', () => {
        /**
         * The guard exists because of the wait for a limiter slot, so what
         * matters is that it is consulted *inside* the slot and not before it.
         * A limiter that defers forever must never reach the guard.
         */
        it('checks the guard only once the limiter slot is granted', async () => {
            const guard = vi.fn().mockResolvedValue(true);

            limiter.schedule.mockImplementation(() => Promise.resolve('deferred'));

            await notificationService.sendMessage('Aegis of the Reef', '+11111111111', undefined, {
                guard,
            });

            expect(guard).not.toHaveBeenCalled();
            expect(client.messages.create).not.toHaveBeenCalled();
        });

        it('does not call Twilio when the guard withholds the send', async () => {
            const guard = vi.fn().mockResolvedValue(false);

            const result = await notificationService.sendMessage(
                'Aegis of the Reef',
                '+11111111111',
                undefined,
                { guard },
            );

            expect(limiter.schedule).toHaveBeenCalledTimes(1);
            expect(guard).toHaveBeenCalledTimes(1);
            expect(client.messages.create).not.toHaveBeenCalled();
            expect(result).toBeUndefined();
        });

        it('calls Twilio when the guard permits the send', async () => {
            const guard = vi.fn().mockResolvedValue(true);

            const result = await notificationService.sendMessage(
                'Aegis of the Reef',
                '+11111111111',
                undefined,
                { guard },
            );

            expect(guard).toHaveBeenCalledTimes(1);
            expect(client.messages.create).toHaveBeenCalledTimes(1);
            expect(result).toBe(mockTwilioCreateMessageResponse);
        });

        it('leaves a send with no guard ungated', async () => {
            await notificationService.sendMessage('Your code is 1234', '+11111111111');

            expect(client.messages.create).toHaveBeenCalledTimes(1);
        });
    });

    it('wraps sendMessage with retry using isTransientError', async () => {
        await notificationService.sendMessage('Aegis of the Reef', '+11111111111');

        expect(withRetry).toHaveBeenCalledWith(expect.any(Function), {
            shouldRetry: isTransientError,
            maxRetries: 0,
        });
    });

    it('sendMessage', async () => {
        const { sid, dateCreated, status } = await notificationService.sendMessage(
            'Aegis of the Reef',
            '+11111111111',
        );

        expect(sid).toEqual(mockTwilioCreateMessageResponse.sid);
        expect(dateCreated).toEqual(mockTwilioCreateMessageResponse.dateCreated);
        expect(status).toEqual(mockTwilioCreateMessageResponse.status);
    });

    it('prefixes the message body with the brand name for carrier compliance', async () => {
        await notificationService.sendMessage('Aegis of the Reef', '+11111111111');

        expect(client.messages.create).toHaveBeenCalledWith(
            expect.objectContaining({ body: 'Destiny-Ghost: Aegis of the Reef' }),
        );
    });

    describe('a send for a claim check (#719)', () => {
        const claimCheckNumber = 'cc-1';
        const to = '+11111111111';
        const body = 'Destiny-Ghost: Aegis of the Reef';
        const options = { claimCheckNumber, notificationType: 'Xur' };
        const key = `${claimCheckNumber}:${to}`;

        /**
         * Twilio with faults to inject: `create` takes the message and then
         * fails to say so (`acceptThenFail`), or fails without taking it
         * (`failWith`). `list` and `fetch` read back what it took.
         */
        const fakeTwilio = () => {
            /** @type {Array<Record<string, unknown>>} */
            const taken = [];
            const provider = {
                taken,
                /** @type {unknown} */ acceptThenFail: undefined,
                /** @type {unknown} */ failWith: undefined,
            };
            const messages = Object.assign(
                vi.fn(sid => ({
                    fetch: vi.fn(async () => taken.find(message => message.sid === sid)),
                })),
                {
                    create: vi.fn(async message => {
                        if (provider.failWith) throw provider.failWith;

                        const sent = {
                            ...message,
                            sid: `SM${String(taken.length + 1).padStart(32, '0')}`,
                            status: 'queued',
                            direction: 'outbound-api',
                            dateCreated: new Date(),
                        };

                        taken.unshift(sent);
                        if (provider.acceptThenFail) throw provider.acceptThenFail;

                        return sent;
                    }),
                    list: vi.fn(async ({ to: recipient, limit }) =>
                        taken.filter(message => message.to === recipient).slice(0, limit),
                    ),
                },
            );

            return {
                provider,
                service: new Notifications({ client: { messages }, limiter }),
                messages,
            };
        };
        const timeout = Object.assign(new Error('timeout'), { code: 'ETIMEDOUT' });

        it('should record the attempt before sending and the SID after', async () => {
            const { service, messages } = fakeTwilio();

            DispatchRecord.begin.mockImplementationOnce(async (...args) => {
                expect(messages.create).not.toHaveBeenCalled();
                records.set(key, { state: 'attempting', at: Date.now(), body: args[2] });
            });

            const sent = await service.sendMessage('Aegis of the Reef', to, undefined, options);

            expect(DispatchRecord.begin).toHaveBeenCalledWith(claimCheckNumber, to, body);
            expect(records.get(key)).toEqual({ state: 'accepted', sid: sent.sid });
        });

        it('should not send again after Twilio took it but the answer was lost', async () => {
            const { provider, service, messages } = fakeTwilio();

            provider.acceptThenFail = timeout;
            const first = service.sendMessage('Aegis of the Reef', to, undefined, options);

            await expect(first).rejects.toBeInstanceOf(SendOutcomeUnknownError);
            await expect(first).rejects.toHaveProperty('cause', timeout);
            expect(records.get(key)).toMatchObject({ state: 'attempting' });

            provider.acceptThenFail = undefined;
            const second = await service.sendMessage('Aegis of the Reef', to, undefined, options);

            expect(messages.create).toHaveBeenCalledTimes(1);
            expect(second.sid).toBe(provider.taken[0].sid);
            expect(records.get(key)).toEqual({ state: 'accepted', sid: second.sid });
        });

        it('should not send again after a crash once the SID was recorded', async () => {
            const { provider, service, messages } = fakeTwilio();
            const first = await service.sendMessage('Aegis of the Reef', to, undefined, options);

            const second = await service.sendMessage('Aegis of the Reef', to, undefined, options);

            expect(messages.create).toHaveBeenCalledTimes(1);
            expect(messages).toHaveBeenCalledWith(first.sid);
            expect(second).toBe(provider.taken[0]);
        });

        it('should adopt the message an attempt that crashed before recording its SID sent', async () => {
            const { provider, service, messages } = fakeTwilio();

            DispatchRecord.accept.mockImplementationOnce(async () => {});
            await service.sendMessage('Aegis of the Reef', to, undefined, options);
            expect(records.get(key)).toMatchObject({ state: 'attempting' });

            const second = await service.sendMessage('Aegis of the Reef', to, undefined, options);

            expect(messages.create).toHaveBeenCalledTimes(1);
            expect(second).toBe(provider.taken[0]);
        });

        it('should match the text the earlier attempt sent, not what this one would', async () => {
            const { provider, service, messages } = fakeTwilio();

            provider.acceptThenFail = timeout;
            await expect(
                service.sendMessage('Aegis of the Reef', to, undefined, options),
            ).rejects.toThrow();
            provider.acceptThenFail = undefined;

            await service.sendMessage('Xur has closed shop.', to, undefined, options);

            expect(messages.create).toHaveBeenCalledTimes(1);
        });

        it('should look again later when the attempt is too recent to be listed', async () => {
            const { service, messages } = fakeTwilio();

            records.set(key, {
                state: 'attempting',
                at: Date.now() - RECONCILE_AFTER_MS + 1000,
                body,
            });

            await expect(
                service.sendMessage('Aegis of the Reef', to, undefined, options),
            ).rejects.toBeInstanceOf(SendOutcomeUnknownError);
            expect(messages.create).not.toHaveBeenCalled();
            expect(records.get(key)).toMatchObject({ state: 'attempting' });
        });

        it('should send once an attempt Twilio never listed is old enough', async () => {
            const { service, messages } = fakeTwilio();

            records.set(key, { state: 'attempting', at: Date.now() - RECONCILE_AFTER_MS, body });

            const sent = await service.sendMessage('Aegis of the Reef', to, undefined, options);

            expect(messages.create).toHaveBeenCalledTimes(1);
            expect(records.get(key)).toEqual({ state: 'accepted', sid: sent.sid });
        });

        it.each([
            ['with other text', { body: 'Destiny-Ghost: something else' }],
            ['received rather than sent', { direction: 'inbound' }],
            [
                'created before the attempt',
                { dateCreated: new Date(Date.now() - CLOCK_SKEW_MS - RECONCILE_AFTER_MS - 1000) },
            ],
        ])('should not adopt a message %s', async (_, difference) => {
            const { provider, service, messages } = fakeTwilio();

            provider.taken.push({
                sid: `SM${'f'.repeat(32)}`,
                to,
                body,
                direction: 'outbound-api',
                dateCreated: new Date(),
                ...difference,
            });
            records.set(key, { state: 'attempting', at: Date.now() - RECONCILE_AFTER_MS, body });

            await service.sendMessage('Aegis of the Reef', to, undefined, options);

            expect(messages.create).toHaveBeenCalledTimes(1);
        });

        it.each([
            ['Twilio refused it', Object.assign(new Error('invalid'), { status: 400 })],
            ['Twilio throttled it', Object.assign(new Error('slow down'), { status: 429 })],
            [
                'the request never left',
                Object.assign(new Error('refused'), { code: 'ECONNREFUSED' }),
            ],
        ])('should drop the record and rethrow as is when %s', async (_, err) => {
            const { provider, service } = fakeTwilio();

            provider.failWith = err;

            await expect(
                service.sendMessage('Aegis of the Reef', to, undefined, options),
            ).rejects.toBe(err);
            expect(records.has(key)).toBe(false);
        });

        it.each([
            ['Twilio failed with a 5xx', Object.assign(new Error('oops'), { status: 503 })],
            ['the connection was reset', Object.assign(new Error('reset'), { code: 'ECONNRESET' })],
            ['the error is not one it recognises', new Error('unexpected')],
        ])('should keep the record and report an unknown outcome when %s', async (_, err) => {
            const { provider, service } = fakeTwilio();

            provider.failWith = err;

            const sending = service.sendMessage('Aegis of the Reef', to, undefined, options);

            await expect(sending).rejects.toBeInstanceOf(SendOutcomeUnknownError);
            await expect(sending).rejects.toHaveProperty('cause', err);
            expect(records.get(key)).toMatchObject({ state: 'attempting', body });
        });

        it('should not send when the attempt cannot be recorded', async () => {
            const { service, messages } = fakeTwilio();
            const err = new Error('down');

            DispatchRecord.begin.mockRejectedValueOnce(err);

            await expect(
                service.sendMessage('Aegis of the Reef', to, undefined, options),
            ).rejects.toBe(err);
            expect(messages.create).not.toHaveBeenCalled();
        });

        it.each([
            [
                'the record cannot be read',
                fake => DispatchRecord.read.mockRejectedValueOnce(fake.err),
            ],
            [
                'Twilio cannot be asked',
                fake => {
                    records.set(key, { state: 'attempting', at: 0, body });
                    fake.messages.list.mockRejectedValueOnce(fake.err);
                },
            ],
        ])('should neither guess nor send when %s', async (_, arrange) => {
            const fake = { ...fakeTwilio(), err: new Error('down') };

            arrange(fake);

            await expect(
                fake.service.sendMessage('Aegis of the Reef', to, undefined, options),
            ).rejects.toBe(fake.err);
            expect(fake.messages.create).not.toHaveBeenCalled();
        });

        it('should leave no record when the guard withholds the send', async () => {
            const { service, messages } = fakeTwilio();

            await service.sendMessage('Aegis of the Reef', to, undefined, {
                ...options,
                guard: async () => false,
            });

            expect(DispatchRecord.begin).not.toHaveBeenCalled();
            expect(messages.create).not.toHaveBeenCalled();
        });

        it('should keep no record of a send without a claim check', async () => {
            const { service } = fakeTwilio();

            await service.sendMessage('Your code is 1234', to);

            expect(DispatchRecord.read).not.toHaveBeenCalled();
            expect(DispatchRecord.begin).not.toHaveBeenCalled();
            expect(DispatchRecord.accept).not.toHaveBeenCalled();
        });
    });
});
