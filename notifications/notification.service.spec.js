import { beforeEach, describe, expect, it, vi } from 'vitest';
import mockTwilioCreateMessageResponse from '../mocks/twilioCreateMessageResponse.json';
import { MAX_SMS_MESSAGE_LENGTH } from '../twilio/twilio.constants.js';
import Notifications, {
    CLOCK_SKEW_MS,
    RECONCILE_AFTER_MS,
    TWILIO_REQUEST_TIMEOUT_MS,
} from './notification.service.js';
import SendDeferredError from './send-deferred.error.js';
import SendOutcomeUnknownError from './send-outcome-unknown.error.js';
import DispatchRecord from '../helpers/dispatch-record.js';
/**
 * The record kept in memory, so the cases below can drive a send through each
 * state and assert what the next attempt does with it.
 */
const records = vi.hoisted(() => new Map());

/**
 * Replaces the record at `key` only if it still holds `expected`, as the real
 * module's script does.
 */
const replaceRecord = vi.hoisted(() => (key, expected, replacement) => {
    if (JSON.stringify(records.get(key) ?? null) !== JSON.stringify(expected)) return false;
    if (replacement) records.set(key, replacement);
    else records.delete(key);

    return true;
});

vi.mock('../helpers/dispatch-record.js', () => ({
    default: {
        read: vi.fn(async (claimCheckNumber, phoneNumber) =>
            structuredClone(records.get(`${claimCheckNumber}:${phoneNumber}`) ?? null),
        ),
        begin: vi.fn(async (claimCheckNumber, phoneNumber, body, seen) => {
            const record = { state: 'attempting', at: Date.now(), body };

            return replaceRecord(`${claimCheckNumber}:${phoneNumber}`, seen, record)
                ? record
                : null;
        }),
        accept: vi.fn(async (claimCheckNumber, phoneNumber, sid, mine) =>
            replaceRecord(`${claimCheckNumber}:${phoneNumber}`, mine, { state: 'accepted', sid }),
        ),
        unsettled: vi.fn(async (claimCheckNumber, phoneNumber, mine) =>
            replaceRecord(`${claimCheckNumber}:${phoneNumber}`, mine, {
                ...mine,
                failedAt: Date.now(),
            }),
        ),
        forget: vi.fn(async (claimCheckNumber, phoneNumber, mine) =>
            replaceRecord(`${claimCheckNumber}:${phoneNumber}`, mine, null),
        ),
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

    /**
     * BullMQ retries the job; a retry in here would send again without
     * settling the earlier attempt first (#719).
     */
    it('sends once, leaving retries to the job', async () => {
        const err = Object.assign(new Error('Service Unavailable'), { status: 503 });

        client.messages.create.mockRejectedValueOnce(err);

        await expect(
            notificationService.sendMessage('Aegis of the Reef', '+11111111111'),
        ).rejects.toBe(err);
        expect(client.messages.create).toHaveBeenCalledTimes(1);
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
         * (`failWith`). `list` reads back what it took.
         */
        const fakeTwilio = () => {
            /** @type {Array<Record<string, unknown>>} */
            const taken = [];
            const provider = {
                taken,
                /** @type {unknown} */ acceptThenFail: undefined,
                /** @type {unknown} */ failWith: undefined,
            };
            const messages = {
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
            };

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
                const record = { state: 'attempting', at: Date.now(), body: args[2] };

                records.set(key, record);

                return record;
            });

            const sent = await service.sendMessage('Aegis of the Reef', to, undefined, options);

            expect(DispatchRecord.begin).toHaveBeenCalledWith(claimCheckNumber, to, body, null);
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
            expect(second).toEqual({ sid: first.sid, status: 'accepted' });
            expect(provider.taken).toHaveLength(1);
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
                failedAt: Date.now() - RECONCILE_AFTER_MS + 1000,
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

            records.set(key, {
                state: 'attempting',
                at: Date.now() - RECONCILE_AFTER_MS,
                failedAt: Date.now() - RECONCILE_AFTER_MS,
                body,
            });

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
            /**
             * Most likely another operation's identical text: the allowance
             * for clocks is seconds, not the minute it once was.
             */
            [
                'sent ten seconds before the attempt',
                { dateCreated: new Date(Date.now() - RECONCILE_AFTER_MS - 10_000) },
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
            records.set(key, {
                state: 'attempting',
                at: Date.now() - RECONCILE_AFTER_MS,
                failedAt: Date.now() - RECONCILE_AFTER_MS,
                body,
            });

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

        it('should defer, not send, when the attempt cannot be recorded', async () => {
            const { service, messages } = fakeTwilio();
            const err = new Error('down');

            DispatchRecord.begin.mockRejectedValueOnce(err);

            const sending = service.sendMessage('Aegis of the Reef', to, undefined, options);

            await expect(sending).rejects.toBeInstanceOf(SendDeferredError);
            await expect(sending).rejects.toHaveProperty('cause', err);
            expect(messages.create).not.toHaveBeenCalled();
        });

        /**
         * A stalled job's second copy can read the record, then wait for a
         * slot while the first copy sends: it must not send over it.
         */
        it.each([
            ['began', { state: 'attempting', at: Date.now(), body }],
            ['was accepted', { state: 'accepted', sid: `SM${'e'.repeat(32)}` }],
        ])(
            'should back off when another copy of the job %s while it waited for a slot',
            async (_, record) => {
                const { service, messages } = fakeTwilio();

                limiter.schedule.mockImplementationOnce(async fn => {
                    records.set(key, record);

                    return fn();
                });

                await expect(
                    service.sendMessage('Aegis of the Reef', to, undefined, options),
                ).rejects.toBeInstanceOf(SendOutcomeUnknownError);
                expect(messages.create).not.toHaveBeenCalled();
                expect(records.get(key)).toEqual(record);
            },
        );

        it.each([
            ['dropped', true, null],
            ['left behind', false, expect.objectContaining({ state: 'attempting' })],
        ])('should send afresh over an old enough attempt it %s', async (_, dropped, seen) => {
            const { service, messages } = fakeTwilio();

            records.set(key, {
                state: 'attempting',
                at: Date.now() - RECONCILE_AFTER_MS,
                failedAt: Date.now() - RECONCILE_AFTER_MS,
                body,
            });
            if (!dropped) DispatchRecord.forget.mockResolvedValueOnce(false);

            await service.sendMessage('Aegis of the Reef', to, undefined, options);

            expect(DispatchRecord.begin).toHaveBeenCalledWith(claimCheckNumber, to, body, seen);
            expect(messages.create).toHaveBeenCalledTimes(1);
        });

        /**
         * Half an emoji goes out as U+FFFD, so Twilio would store text that
         * no longer matches the record.
         */
        it('should not cut a character in half at the length limit', async () => {
            const { service, messages } = fakeTwilio();
            const prefix = 'Destiny-Ghost: ';
            const long = `${'x'.repeat(MAX_SMS_MESSAGE_LENGTH - prefix.length - 1)}🙂 and more`;

            await service.sendMessage(long, to, undefined, options);

            const sent = messages.create.mock.calls[0][0].body;

            expect(sent).toBe(`${prefix}${'x'.repeat(MAX_SMS_MESSAGE_LENGTH - prefix.length - 1)}`);
            expect(DispatchRecord.begin).toHaveBeenCalledWith(claimCheckNumber, to, sent, null);
        });

        it.each([
            /**
             * Nothing was sent by this attempt, and the next may be able to
             * read it: deferred, not unknown.
             */
            [
                'the record cannot be read',
                fake => DispatchRecord.read.mockRejectedValueOnce(fake.err),
                SendDeferredError,
            ],
            /** There is a record to settle, and Twilio may have its message. */
            [
                'Twilio cannot be asked',
                fake => {
                    records.set(key, { state: 'attempting', at: 0, body });
                    fake.messages.list.mockRejectedValueOnce(fake.err);
                },
                SendOutcomeUnknownError,
            ],
        ])('should neither guess nor send when %s', async (_, arrange, expected) => {
            const fake = { ...fakeTwilio(), err: new Error('down') };

            arrange(fake);

            const sending = fake.service.sendMessage('Aegis of the Reef', to, undefined, options);

            await expect(sending).rejects.toBeInstanceOf(expected);
            await expect(sending).rejects.toHaveProperty('cause', fake.err);
            expect(fake.messages.create).not.toHaveBeenCalled();
        });

        /**
         * `create` can take most of its timeout before failing; the wait for
         * Twilio to list the message starts from the failure, not the begin.
         */
        it('should wait from when an ambiguous answer came back, not from when the send began', async () => {
            const { provider, service, messages } = fakeTwilio();

            provider.failWith = timeout;
            await expect(
                service.sendMessage('Aegis of the Reef', to, undefined, options),
            ).rejects.toBeInstanceOf(SendOutcomeUnknownError);
            const record = records.get(key);

            expect(record).toMatchObject({ state: 'attempting', failedAt: expect.any(Number) });
            records.set(key, { ...record, at: record.at - 30_000 });
            provider.failWith = undefined;

            await expect(
                service.sendMessage('Aegis of the Reef', to, undefined, options),
            ).rejects.toBeInstanceOf(SendOutcomeUnknownError);
            expect(messages.create).toHaveBeenCalledTimes(1);
        });

        it('should look an earlier attempt up through the rate limiter', async () => {
            const { service, messages } = fakeTwilio();
            let inSlot = 0;

            limiter.schedule.mockImplementation(async fn => {
                inSlot += 1;
                try {
                    return await fn();
                } finally {
                    inSlot -= 1;
                }
            });
            messages.list.mockImplementation(async () => {
                expect(inSlot).toBe(1);

                return [];
            });
            records.set(key, {
                state: 'attempting',
                at: Date.now() - RECONCILE_AFTER_MS,
                failedAt: Date.now() - RECONCILE_AFTER_MS,
                body,
            });

            await service.sendMessage('Aegis of the Reef', to, undefined, options);

            expect(messages.list).toHaveBeenCalledOnce();
        });

        /**
         * A copy that took over while this one's `create` was in flight keeps
         * its record, whatever this one then hears back from Twilio.
         */
        it.each([
            ['accepted', undefined],
            ['refused', Object.assign(new Error('invalid'), { status: 400 })],
            ['left unknown', timeout],
        ])("should leave a newer copy's record when its own send is %s", async (_, failure) => {
            const { service, messages } = fakeTwilio();
            const theirs = { state: 'attempting', at: Date.now(), body: 'theirs' };
            const create = messages.create.getMockImplementation();

            messages.create.mockImplementationOnce(async message => {
                records.set(key, theirs);
                if (failure) throw failure;

                return create(message);
            });

            await service.sendMessage('Aegis of the Reef', to, undefined, options).catch(() => {});

            expect(records.get(key)).toEqual(theirs);
        });

        /**
         * No failure recorded: the attempt may have crashed, or may still be
         * waiting on Twilio in a copy of the job that stalled, so the wait
         * counts from when its request could last have been answered.
         */
        it.each([
            ["still within Twilio's request timeout", RECONCILE_AFTER_MS + 1000, 0],
            ['past it and the wait after', TWILIO_REQUEST_TIMEOUT_MS + RECONCILE_AFTER_MS, 1],
        ])(
            'with no failure recorded, should send only once an attempt is %s',
            async (_, age, creates) => {
                const { service, messages } = fakeTwilio();

                records.set(key, { state: 'attempting', at: Date.now() - age, body });

                await service
                    .sendMessage('Aegis of the Reef', to, undefined, options)
                    .catch(() => {});

                expect(messages.create).toHaveBeenCalledTimes(creates);
            },
        );

        it.each([
            ['its Redis is down', new Error('ECONNREFUSED')],
            [
                'its queue is full',
                Object.assign(new Error("Number of requests reached it's maximum"), {
                    name: 'RateLimiterQueueError',
                }),
            ],
        ])('should defer, not fail, a send the rate limiter refuses because %s', async (_, err) => {
            const { service, messages } = fakeTwilio();

            limiter.schedule.mockRejectedValueOnce(err);

            const sending = service.sendMessage('Aegis of the Reef', to, undefined, options);

            await expect(sending).rejects.toBeInstanceOf(SendDeferredError);
            await expect(sending).rejects.toHaveProperty('cause', err);
            expect(messages.create).not.toHaveBeenCalled();
        });

        it('should rethrow a rate limiter failure as is for a send without a claim check', async () => {
            const { service } = fakeTwilio();
            const err = new Error('down');

            limiter.schedule.mockRejectedValueOnce(err);

            await expect(service.sendMessage('Your code is 1234', to)).rejects.toBe(err);
        });

        it('should not defer a failure from the send itself', async () => {
            const { provider, service } = fakeTwilio();
            const refused = Object.assign(new Error('invalid'), { status: 400 });

            provider.failWith = refused;

            await expect(
                service.sendMessage('Aegis of the Reef', to, undefined, options),
            ).rejects.toBe(refused);
        });

        describe('settleEarlier', () => {
            it('should find nothing when no attempt was made', async () => {
                const { service, messages } = fakeTwilio();

                await expect(service.settleEarlier(claimCheckNumber, to)).resolves.toEqual({
                    seen: null,
                });
                expect(messages.list).not.toHaveBeenCalled();
            });

            it('should report an accepted send from its record', async () => {
                const { service } = fakeTwilio();
                const accepted = { state: 'accepted', sid: `SM${'d'.repeat(32)}` };

                records.set(key, accepted);

                await expect(service.settleEarlier(claimCheckNumber, to)).resolves.toEqual({
                    earlier: { sid: accepted.sid, status: 'accepted' },
                    seen: accepted,
                });
            });

            it('should find an attempt Twilio listed, without sending', async () => {
                const { provider, service, messages } = fakeTwilio();

                provider.acceptThenFail = timeout;
                await service
                    .sendMessage('Aegis of the Reef', to, undefined, options)
                    .catch(() => {});

                const settled = await service.settleEarlier(claimCheckNumber, to);

                expect(settled.earlier).toBe(provider.taken[0]);
                expect(messages.create).toHaveBeenCalledTimes(1);
                expect(messages.list).toHaveBeenCalledWith(
                    expect.objectContaining({ to, from: expect.any(String) }),
                );
            });

            it('should throw while an attempt is too recent to settle', async () => {
                const { service } = fakeTwilio();

                records.set(key, {
                    state: 'attempting',
                    at: Date.now(),
                    failedAt: Date.now(),
                    body,
                });

                await expect(service.settleEarlier(claimCheckNumber, to)).rejects.toBeInstanceOf(
                    SendOutcomeUnknownError,
                );
            });

            /**
             * The decision stands: a job that then fails for another reason
             * is not reported as perhaps having sent it.
             */
            it('should drop an unlisted attempt once it is old enough', async () => {
                const { service } = fakeTwilio();

                records.set(key, {
                    state: 'attempting',
                    at: Date.now() - RECONCILE_AFTER_MS,
                    failedAt: Date.now() - RECONCILE_AFTER_MS,
                    body,
                });

                await expect(service.settleEarlier(claimCheckNumber, to)).resolves.toEqual({
                    seen: null,
                });
                expect(records.has(key)).toBe(false);
            });

            it('should keep what it read when the record cannot be dropped', async () => {
                const { service } = fakeTwilio();
                const record = {
                    state: 'attempting',
                    at: Date.now() - RECONCILE_AFTER_MS,
                    failedAt: Date.now() - RECONCILE_AFTER_MS,
                    body,
                };

                records.set(key, record);
                DispatchRecord.forget.mockResolvedValueOnce(false);

                await expect(service.settleEarlier(claimCheckNumber, to)).resolves.toEqual({
                    seen: record,
                });
            });

            it('should let sendMessage use what it found, rather than look again', async () => {
                const { service, messages } = fakeTwilio();
                const settled = await service.settleEarlier(claimCheckNumber, to);

                DispatchRecord.read.mockClear();
                await service.sendMessage('Aegis of the Reef', to, undefined, {
                    ...options,
                    settled,
                });

                expect(DispatchRecord.read).not.toHaveBeenCalled();
                expect(messages.create).toHaveBeenCalledTimes(1);
            });

            it('should still back off when the record changed after it was settled', async () => {
                const { service, messages } = fakeTwilio();
                const settled = await service.settleEarlier(claimCheckNumber, to);

                records.set(key, { state: 'attempting', at: Date.now(), body: 'another copy' });

                await expect(
                    service.sendMessage('Aegis of the Reef', to, undefined, {
                        ...options,
                        settled,
                    }),
                ).rejects.toBeInstanceOf(SendOutcomeUnknownError);
                expect(messages.create).not.toHaveBeenCalled();
            });
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
