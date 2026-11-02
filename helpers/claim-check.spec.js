import { afterEach, describe, expect, it, beforeEach, vi } from 'vitest';
import ClaimCheck, {
    ADVANCE,
    CLAIM_CHECK_READ_TIMEOUT_MS,
    CLAIM_CHECK_TIMEOUT_MS,
    claimCheckExpiration,
    DUPLICATE,
    ERROR,
    PENDING,
    RECORD_PENDING,
    SKIPPED,
} from './claim-check.js';
import cache from './cache.js';
import log from './log.js';
import { fakeRedis } from '../vitest.redis-lua.js';

vi.mock('./cache.js', () => ({
    default: {
        eval: vi.fn(),
        hGetAll: vi.fn(),
        withCommandOptions: vi.fn(),
    },
}));
vi.mock('./log.js', () => ({
    default: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));
vi.mock('@paralleldrive/cuid2', () => ({
    createId: vi.fn(() => 'test-claim-check-id'),
}));

const testPhoneNumber = '+1234567890';
const testPhoneNumber2 = '+0987654321';
const testClaimCheckId = 'test-claim-check-id';
const sid = `SM${'a'.repeat(32)}`;
const otherSid = `SM${'b'.repeat(32)}`;

describe('ClaimCheck', () => {
    afterEach(() => {
        vi.useRealTimers();
    });

    /** @type {ClaimCheck} */
    let claimCheck;
    /** @type {ReturnType<typeof fakeRedis>} */
    let redis;

    const entryOf = async phoneNumber =>
        (await ClaimCheck.getClaimCheck(testClaimCheckId))?.[phoneNumber];

    beforeEach(() => {
        vi.clearAllMocks();
        // The real `ADVANCE` and `RECORD_PENDING`, on an in-memory Redis (#777).
        redis = fakeRedis();
        cache.eval.mockImplementation(redis.eval);
        cache.hGetAll.mockImplementation(redis.hGetAll);
        /**
         * Stands in for node-redis's options proxy: the same commands, with
         * the options they were sent under as `this`, so a test can tell a
         * command sent through it from one sent on the bare client.
         */
        cache.withCommandOptions.mockImplementation(options => ({
            options,
            eval: cache.eval,
            hGetAll: cache.hGetAll,
        }));
        claimCheck = new ClaimCheck();
    });

    describe('constructor and number property', () => {
        it('should create a new instance with a unique claim check number', () => {
            expect(claimCheck.number).toBe(testClaimCheckId);
        });

        it('should generate different numbers for different instances', async () => {
            const { createId } = await import('@paralleldrive/cuid2');

            vi.mocked(createId).mockReturnValueOnce('different-id');

            expect(new ClaimCheck().number).toBe('different-id');
        });

        it('should take an operation id the caller already minted', () => {
            expect(new ClaimCheck('operation-id').number).toBe('operation-id');
        });

        it('should make number property read-only', () => {
            expect(() => {
                claimCheck.number = 'modified-number';
            }).toThrow();
            expect(claimCheck.number).toBe(testClaimCheckId);
        });
    });

    describe('addPhoneNumber', () => {
        it('should record a recipient as pending and set the expiry', async () => {
            await expect(claimCheck.addPhoneNumber(testPhoneNumber)).resolves.toBe(true);

            expect(cache.eval).toHaveBeenCalledExactlyOnceWith(RECORD_PENDING, {
                keys: [testClaimCheckId],
                arguments: [
                    testPhoneNumber,
                    JSON.stringify({ status: PENDING }),
                    String(claimCheckExpiration),
                ],
            });
            await expect(entryOf(testPhoneNumber)).resolves.toEqual({ status: PENDING });
            expect(redis.ttl(testClaimCheckId)).toBe(claimCheckExpiration);
        });

        it('should keep what a resumed broadcast already recorded', async () => {
            await claimCheck.addPhoneNumber(testPhoneNumber);
            await ClaimCheck.advance(testClaimCheckId, testPhoneNumber, {
                status: 'delivered',
                sid,
            });
            await claimCheck.addPhoneNumber(testPhoneNumber);

            await expect(entryOf(testPhoneNumber)).resolves.toEqual({
                status: 'delivered',
                sid,
            });
        });

        /**
         * node-redis queues a command while it reconnects instead of failing
         * it, so without a bound this would wait on a connection that may
         * never come back - and hold the send up with it.
         */
        it('should give up on a write Redis does not answer in time', async () => {
            vi.useFakeTimers();
            cache.eval.mockReturnValueOnce(new Promise(() => {}));

            const recording = claimCheck.addPhoneNumber(testPhoneNumber);

            await vi.advanceTimersByTimeAsync(CLAIM_CHECK_TIMEOUT_MS);
            await expect(recording).resolves.toBe(false);
            expect(log.warn).toHaveBeenCalledWith(
                expect.objectContaining({
                    err: expect.objectContaining({
                        message: expect.stringContaining(
                            `did not answer within ${CLAIM_CHECK_TIMEOUT_MS}ms`,
                        ),
                    }),
                    claimCheckNumber: testClaimCheckId,
                    phoneNumber: testPhoneNumber,
                }),
                'Unable to record the recipient on the claim check; sending without it.',
            );
        });

        /**
         * The recipient is sent to either way; a receipt that cannot be
         * written must not stop that.
         */
        it('should report a recipient Redis would not record, rather than reject', async () => {
            cache.eval.mockRejectedValueOnce(new Error('Cache connection failed'));

            await expect(claimCheck.addPhoneNumber(testPhoneNumber)).resolves.toBe(false);
            expect(log.warn).toHaveBeenCalledWith(
                expect.objectContaining({ err: new Error('Cache connection failed') }),
                'Unable to record the recipient on the claim check; sending without it.',
            );
        });

        it('should not reject when the client throws building the command', async () => {
            cache.eval.mockImplementationOnce(() => {
                throw new Error('Client is closed');
            });

            await expect(claimCheck.addPhoneNumber(testPhoneNumber)).resolves.toBe(false);
        });

        /**
         * A `pending` sent once the client reconnects could land after the
         * recipient's worker had found no entry and finished, making one
         * nothing would move on. node-redis's own timeout drops a command
         * still waiting to be sent instead.
         */
        it('should send with a timeout that drops it if still unsent', async () => {
            await claimCheck.addPhoneNumber(testPhoneNumber);

            expect(cache.eval.mock.contexts[0]).toMatchObject({
                options: { timeout: CLAIM_CHECK_TIMEOUT_MS },
            });
        });
    });

    describe('getClaimCheck', () => {
        it('should return every recipient as an entry', async () => {
            await claimCheck.addPhoneNumber(testPhoneNumber);
            await claimCheck.addPhoneNumber(testPhoneNumber2);
            await ClaimCheck.advance(testClaimCheckId, testPhoneNumber2, {
                status: 'skipped',
                reason: 'unauthenticated',
            });

            await expect(ClaimCheck.getClaimCheck(testClaimCheckId)).resolves.toEqual({
                [testPhoneNumber]: { status: PENDING },
                [testPhoneNumber2]: { status: 'skipped', reason: 'unauthenticated' },
            });
        });

        /**
         * A broadcast's claim check is handed out before its first page is
         * queued, so an empty one is usually one a caller should keep
         * polling, not one that does not exist.
         */
        it('should return an empty receipt for a claim check with no recipients yet', async () => {
            await expect(ClaimCheck.getClaimCheck('no-recipients-yet')).resolves.toEqual({});
        });

        it('should read an entry written before entries were JSON as its bare status', async () => {
            cache.hGetAll.mockResolvedValueOnce({ [testPhoneNumber]: 'delivered' });

            await expect(entryOf(testPhoneNumber)).resolves.toEqual({ status: 'delivered' });
        });

        /**
         * A bare `queued` then meant our queue as often as Twilio's, so it
         * is read as the one that claims less.
         */
        it('should read a bare queued from before entries were JSON as pending', async () => {
            cache.hGetAll.mockResolvedValueOnce({ [testPhoneNumber]: 'queued' });

            await expect(entryOf(testPhoneNumber)).resolves.toEqual({ status: PENDING });
        });

        it('should send with a timeout that drops it if still unsent', async () => {
            await ClaimCheck.getClaimCheck(testClaimCheckId);

            expect(cache.hGetAll.mock.contexts[0]).toMatchObject({
                options: { timeout: CLAIM_CHECK_READ_TIMEOUT_MS },
            });
        });

        /**
         * Unlike a write, a read that failed cannot stand in for one that
         * worked: an empty receipt would say nobody was queued.
         */
        it('should give up on a read Redis does not answer in time', async () => {
            vi.useFakeTimers();
            cache.hGetAll.mockReturnValueOnce(new Promise(() => {}));

            const reading = expect(ClaimCheck.getClaimCheck(testClaimCheckId)).rejects.toThrow(
                `did not answer within ${CLAIM_CHECK_READ_TIMEOUT_MS}ms`,
            );

            await vi.advanceTimersByTimeAsync(CLAIM_CHECK_READ_TIMEOUT_MS);
            await reading;
        });

        /**
         * A broadcast's receipt holds every recipient, so it can take longer
         * to hand over than a write to one of them is given.
         */
        it('should wait longer for a whole receipt than for a write', async () => {
            vi.useFakeTimers();
            cache.hGetAll.mockReturnValueOnce(
                new Promise(resolve => {
                    setTimeout(
                        () => resolve({ [testPhoneNumber]: JSON.stringify({ status: PENDING }) }),
                        CLAIM_CHECK_TIMEOUT_MS * 2,
                    );
                }),
            );

            const reading = ClaimCheck.getClaimCheck(testClaimCheckId);

            await vi.advanceTimersByTimeAsync(CLAIM_CHECK_TIMEOUT_MS * 2);
            await expect(reading).resolves.toEqual({ [testPhoneNumber]: { status: PENDING } });
        });

        it('should reject when Redis does', async () => {
            cache.hGetAll.mockRejectedValueOnce(new Error('Cache read failed'));

            await expect(ClaimCheck.getClaimCheck(testClaimCheckId)).rejects.toThrow(
                'Cache read failed',
            );
        });
    });

    describe('advance', () => {
        beforeEach(async () => {
            await claimCheck.addPhoneNumber(testPhoneNumber);
        });

        it('should hand the script the entry and the expiry', async () => {
            await ClaimCheck.advance(testClaimCheckId, testPhoneNumber, { status: 'sent', sid });

            expect(cache.eval).toHaveBeenLastCalledWith(ADVANCE, {
                keys: [testClaimCheckId],
                arguments: [
                    testPhoneNumber,
                    JSON.stringify({ status: 'sent', sid }),
                    String(claimCheckExpiration),
                ],
            });
        });

        it('should send with a timeout that drops it if still unsent', async () => {
            await ClaimCheck.advance(testClaimCheckId, testPhoneNumber, { status: 'sent', sid });

            expect(cache.eval.mock.contexts.at(-1)).toMatchObject({
                options: { timeout: CLAIM_CHECK_TIMEOUT_MS },
            });
        });

        it('should give up on a write Redis does not answer in time', async () => {
            vi.useFakeTimers();
            cache.eval.mockReturnValueOnce(new Promise(() => {}));

            const advancing = ClaimCheck.advance(testClaimCheckId, testPhoneNumber, {
                status: 'sent',
                sid,
            });

            await vi.advanceTimersByTimeAsync(CLAIM_CHECK_TIMEOUT_MS);
            await expect(advancing).resolves.toBe(false);
        });

        /**
         * Failing the caller would retry a worker whose message Twilio had
         * already accepted, or answer a status callback with an error for a
         * report that was kept.
         */
        it('should report an outcome Redis would not record, rather than reject', async () => {
            const outcome = { status: 'sent', sid };

            cache.eval.mockRejectedValueOnce(new Error('Cache write failed'));

            await expect(
                ClaimCheck.advance(testClaimCheckId, testPhoneNumber, outcome),
            ).resolves.toBe(false);
            expect(log.warn).toHaveBeenCalledWith(
                {
                    err: new Error('Cache write failed'),
                    claimCheckNumber: testClaimCheckId,
                    phoneNumber: testPhoneNumber,
                    outcome,
                },
                'Unable to record the claim-check outcome.',
            );
        });

        it('should not reject when the client throws building the command', async () => {
            cache.eval.mockImplementationOnce(() => {
                throw new Error('Client is closed');
            });

            await expect(
                ClaimCheck.advance(testClaimCheckId, testPhoneNumber, { status: 'sent', sid }),
            ).resolves.toBe(false);
        });

        it("should refresh the receipt's expiry when it moves a recipient", async () => {
            redis.call('EXPIRE', testClaimCheckId, '5');

            await ClaimCheck.advance(testClaimCheckId, testPhoneNumber, { status: 'queued', sid });

            expect(redis.ttl(testClaimCheckId)).toBe(claimCheckExpiration);
        });

        it('should move a recipient through every stage in order', async () => {
            for (const status of ['queued', 'sending', 'sent', 'delivered', 'read']) {
                await expect(
                    ClaimCheck.advance(testClaimCheckId, testPhoneNumber, { status, sid }),
                ).resolves.toBe(true);
            }

            await expect(entryOf(testPhoneNumber)).resolves.toEqual({ status: 'read', sid });
        });

        it('should not let a late report move a delivered recipient back', async () => {
            await ClaimCheck.advance(testClaimCheckId, testPhoneNumber, {
                status: 'delivered',
                sid,
            });

            for (const status of ['sent', 'sending', 'queued', PENDING]) {
                await expect(
                    ClaimCheck.advance(testClaimCheckId, testPhoneNumber, { status, sid }),
                ).resolves.toBe(false);
            }

            await expect(entryOf(testPhoneNumber)).resolves.toEqual({
                status: 'delivered',
                sid,
            });
        });

        it('should not let one terminal status replace another', async () => {
            await ClaimCheck.advance(testClaimCheckId, testPhoneNumber, {
                status: 'delivered',
                sid,
            });

            await expect(
                ClaimCheck.advance(testClaimCheckId, testPhoneNumber, { status: 'failed', sid }),
            ).resolves.toBe(false);
            await expect(entryOf(testPhoneNumber)).resolves.toEqual({
                status: 'delivered',
                sid,
            });
        });

        it('should treat a repeated report as a no-op', async () => {
            await ClaimCheck.advance(testClaimCheckId, testPhoneNumber, { status: 'sent', sid });

            await expect(
                ClaimCheck.advance(testClaimCheckId, testPhoneNumber, { status: 'sent', sid }),
            ).resolves.toBe(false);
        });

        it("should ignore a report for a message other than the one it's tracking", async () => {
            await ClaimCheck.advance(testClaimCheckId, testPhoneNumber, { status: 'queued', sid });

            await expect(
                ClaimCheck.advance(testClaimCheckId, testPhoneNumber, {
                    status: 'delivered',
                    sid: otherSid,
                }),
            ).resolves.toBe(false);
            await expect(entryOf(testPhoneNumber)).resolves.toEqual({ status: 'queued', sid });
        });

        it('should keep the sid of a report that beat the worker to the receipt', async () => {
            // Twilio's callback lands before `sendMessage` has returned its sid.
            await ClaimCheck.advance(testClaimCheckId, testPhoneNumber, {
                status: 'sent',
                sid,
            });
            await ClaimCheck.advance(testClaimCheckId, testPhoneNumber, {
                status: 'queued',
                sid,
            });

            await expect(entryOf(testPhoneNumber)).resolves.toEqual({ status: 'sent', sid });
        });

        it('should adopt a sid arriving with a status it already has', async () => {
            await ClaimCheck.advance(testClaimCheckId, testPhoneNumber, { status: 'queued' });

            await expect(
                ClaimCheck.advance(testClaimCheckId, testPhoneNumber, { status: 'queued', sid }),
            ).resolves.toBe(true);
            await expect(entryOf(testPhoneNumber)).resolves.toEqual({ status: 'queued', sid });
        });

        it('should carry the sid forward on a report that has none', async () => {
            await ClaimCheck.advance(testClaimCheckId, testPhoneNumber, { status: 'queued', sid });
            await ClaimCheck.advance(testClaimCheckId, testPhoneNumber, { status: 'delivered' });

            await expect(entryOf(testPhoneNumber)).resolves.toEqual({
                status: 'delivered',
                sid,
            });
        });

        it('should move a recipient found queued elsewhere straight to duplicate', async () => {
            await expect(
                ClaimCheck.advance(testClaimCheckId, testPhoneNumber, { status: DUPLICATE }),
            ).resolves.toBe(true);
        });

        /**
         * One recipient twice in a broadcast, or a job id that changed
         * across a resume: the second queueing is deduplicated against this
         * operation's own job, which is not a duplicate of anything.
         */
        it("should not mark this operation's own message a duplicate", async () => {
            await ClaimCheck.advance(testClaimCheckId, testPhoneNumber, { status: 'queued', sid });

            await expect(
                ClaimCheck.advance(testClaimCheckId, testPhoneNumber, { status: DUPLICATE }),
            ).resolves.toBe(false);

            // ...so its delivery report still lands.
            await ClaimCheck.advance(testClaimCheckId, testPhoneNumber, {
                status: 'delivered',
                sid,
            });
            await expect(entryOf(testPhoneNumber)).resolves.toEqual({
                status: 'delivered',
                sid,
            });
        });

        it.each([
            [SKIPPED, 'opted-out'],
            [ERROR, 'retries-exhausted'],
        ])('should not record %s over a message Twilio holds', async (status, reason) => {
            // Twilio accepted the send, but the client timed out waiting.
            await ClaimCheck.advance(testClaimCheckId, testPhoneNumber, { status: 'sent', sid });

            await expect(
                ClaimCheck.advance(testClaimCheckId, testPhoneNumber, { status, reason }),
            ).resolves.toBe(false);
            await expect(entryOf(testPhoneNumber)).resolves.toEqual({ status: 'sent', sid });
        });

        it.each([
            [SKIPPED, 'opted-out'],
            [ERROR, 'retries-exhausted'],
            [DUPLICATE, undefined],
        ])("should let Twilio's report replace a %s recorded first", async (status, reason) => {
            await ClaimCheck.advance(testClaimCheckId, testPhoneNumber, { status, reason });

            await expect(
                ClaimCheck.advance(testClaimCheckId, testPhoneNumber, { status: 'sent', sid }),
            ).resolves.toBe(true);
            await expect(entryOf(testPhoneNumber)).resolves.toEqual({ status: 'sent', sid });
        });

        it('should take a partial delivery as a final status', async () => {
            await ClaimCheck.advance(testClaimCheckId, testPhoneNumber, { status: 'sent', sid });

            await expect(
                ClaimCheck.advance(testClaimCheckId, testPhoneNumber, {
                    status: 'partially_delivered',
                    sid,
                }),
            ).resolves.toBe(true);
            await expect(
                ClaimCheck.advance(testClaimCheckId, testPhoneNumber, { status: 'sent', sid }),
            ).resolves.toBe(false);
        });

        /**
         * Written before entries carried a sid: Twilio's status is all there
         * is to say a message went out, and that is enough.
         */
        it.each([SKIPPED, ERROR, DUPLICATE])(
            'should not record %s over a Twilio status from before entries were JSON',
            async status => {
                redis.call('HSET', testClaimCheckId, testPhoneNumber, 'sent');

                await expect(
                    ClaimCheck.advance(testClaimCheckId, testPhoneNumber, { status }),
                ).resolves.toBe(false);
                await expect(entryOf(testPhoneNumber)).resolves.toEqual({ status: 'sent' });
            },
        );

        it('should let read replace delivered', async () => {
            await ClaimCheck.advance(testClaimCheckId, testPhoneNumber, {
                status: 'delivered',
                sid,
            });

            await expect(
                ClaimCheck.advance(testClaimCheckId, testPhoneNumber, { status: 'read', sid }),
            ).resolves.toBe(true);
        });

        it.each(['undelivered', 'failed', 'canceled'])(
            'should not let read replace %s',
            async status => {
                await ClaimCheck.advance(testClaimCheckId, testPhoneNumber, { status, sid });

                await expect(
                    ClaimCheck.advance(testClaimCheckId, testPhoneNumber, { status: 'read', sid }),
                ).resolves.toBe(false);
                await expect(entryOf(testPhoneNumber)).resolves.toEqual({ status, sid });
            },
        );

        it('should not create an entry for a recipient it never recorded', async () => {
            await expect(
                ClaimCheck.advance(testClaimCheckId, testPhoneNumber2, {
                    status: 'delivered',
                    sid,
                }),
            ).resolves.toBe(false);
            await expect(entryOf(testPhoneNumber2)).resolves.toBeUndefined();
        });

        /**
         * Declined by the script, not failed in it: a status with no rank
         * would otherwise break its comparisons, and every report Twilio adds
         * a status for would log as a failed write.
         */
        it('should ignore a status it does not know', async () => {
            await expect(
                ClaimCheck.advance(testClaimCheckId, testPhoneNumber, { status: 'receiving' }),
            ).resolves.toBe(false);
            await expect(entryOf(testPhoneNumber)).resolves.toEqual({ status: PENDING });
            expect(log.warn).not.toHaveBeenCalled();
        });

        it('should move an entry written before entries were JSON', async () => {
            redis.call('HSET', testClaimCheckId, testPhoneNumber, 'sent');

            await expect(
                ClaimCheck.advance(testClaimCheckId, testPhoneNumber, { status: 'queued', sid }),
            ).resolves.toBe(true);
            await expect(entryOf(testPhoneNumber)).resolves.toEqual({ status: 'sent', sid });
        });

        /**
         * A bare `queued` meant our queue as well as Twilio's, and is read as
         * ours (`legacy`), so this operation's own outcome may replace it.
         */
        it("should let this operation's outcome replace a bare queued from before entries were JSON", async () => {
            redis.call('HSET', testClaimCheckId, testPhoneNumber, 'queued');

            await expect(
                ClaimCheck.advance(testClaimCheckId, testPhoneNumber, {
                    status: SKIPPED,
                    reason: 'opted-out',
                }),
            ).resolves.toBe(true);
            await expect(entryOf(testPhoneNumber)).resolves.toEqual({
                status: SKIPPED,
                reason: 'opted-out',
            });
        });

        it("should move a bare queued from before entries were JSON on Twilio's report", async () => {
            redis.call('HSET', testClaimCheckId, testPhoneNumber, 'queued');

            await expect(
                ClaimCheck.advance(testClaimCheckId, testPhoneNumber, { status: 'queued', sid }),
            ).resolves.toBe(true);
            await expect(entryOf(testPhoneNumber)).resolves.toEqual({ status: 'queued', sid });
        });
    });
});
