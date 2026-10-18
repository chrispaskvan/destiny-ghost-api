import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import DispatchRecord, {
    BEGIN,
    DISPATCH_RECORD_SLOT_TIMEOUT_MS,
    DISPATCH_RECORD_TIMEOUT_MS,
    DISPATCH_RECORD_TTL_SECONDS,
} from './dispatch-record.js';
import cache from './cache.js';
import log from './log.js';

vi.mock('./cache.js', () => ({
    default: {
        eval: vi.fn(),
        get: vi.fn(),
        set: vi.fn(),
        del: vi.fn(),
        withCommandOptions: vi.fn(),
    },
}));
vi.mock('./log.js', () => ({
    default: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

const claimCheckNumber = 'cc-1';
const phoneNumber = '+1234567890';
const key = `dispatch:${claimCheckNumber}:${phoneNumber}`;
const sid = `SM${'a'.repeat(32)}`;

describe('DispatchRecord', () => {
    /** @type {Map<string, string>} */
    let store;

    beforeEach(() => {
        store = new Map();
        cache.get.mockImplementation(async k => store.get(k) ?? null);
        cache.set.mockImplementation(async (k, v) => {
            store.set(k, v);
            return 'OK';
        });
        cache.del.mockImplementation(async k => Number(store.delete(k)));
        /**
         * A mirror of `BEGIN`, which Redis runs for real: it covers how the
         * module calls the script and reads its answer, not the script.
         */
        cache.eval.mockImplementation(async (script, { keys: [k], arguments: [seen, next] }) => {
            expect(script).toBe(BEGIN);
            if ((store.get(k) ?? '') !== seen) return 0;
            store.set(k, next);
            return 1;
        });
        cache.withCommandOptions.mockImplementation(options => ({
            options,
            eval: cache.eval,
            get: cache.get,
            set: cache.set,
            del: cache.del,
        }));
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    describe('read', () => {
        it('should find nothing for a send never begun', async () => {
            await expect(DispatchRecord.read(claimCheckNumber, phoneNumber)).resolves.toBeNull();
        });

        it('should reject when the record cannot be read', async () => {
            cache.get.mockRejectedValueOnce(new Error('down'));

            await expect(DispatchRecord.read(claimCheckNumber, phoneNumber)).rejects.toThrow(
                'down',
            );
        });

        it('should reject once the read outlasts its timeout', async () => {
            vi.useFakeTimers();
            cache.get.mockReturnValueOnce(new Promise(() => {}));

            const reading = DispatchRecord.read(claimCheckNumber, phoneNumber);
            const settled = expect(reading).rejects.toThrow(`${DISPATCH_RECORD_TIMEOUT_MS}ms`);

            await vi.advanceTimersByTimeAsync(DISPATCH_RECORD_TIMEOUT_MS);
            await settled;
        });

        it('should send with a timeout that drops it if still unsent', async () => {
            await DispatchRecord.read(claimCheckNumber, phoneNumber);

            expect(cache.get.mock.contexts[0]).toEqual(
                expect.objectContaining({ options: { timeout: DISPATCH_RECORD_TIMEOUT_MS } }),
            );
        });
    });

    describe('begin', () => {
        it('should record the attempt, with what was sent and when', async () => {
            vi.useFakeTimers({ now: 1_000 });

            await expect(
                DispatchRecord.begin(claimCheckNumber, phoneNumber, 'hello', null),
            ).resolves.toBe(true);

            expect(cache.eval).toHaveBeenCalledWith(BEGIN, {
                keys: [key],
                arguments: ['', expect.any(String), String(DISPATCH_RECORD_TTL_SECONDS)],
            });
            await expect(DispatchRecord.read(claimCheckNumber, phoneNumber)).resolves.toEqual({
                state: 'attempting',
                at: 1_000,
                body: 'hello',
            });
        });

        it('should take over an attempt that is still what was read', async () => {
            await DispatchRecord.begin(claimCheckNumber, phoneNumber, 'first', null);
            const seen = await DispatchRecord.read(claimCheckNumber, phoneNumber);

            await expect(
                DispatchRecord.begin(claimCheckNumber, phoneNumber, 'second', seen),
            ).resolves.toBe(true);
            await expect(DispatchRecord.read(claimCheckNumber, phoneNumber)).resolves.toMatchObject(
                { body: 'second' },
            );
        });

        it.each([
            ['another attempt began since nothing was read', async () => null],
            [
                'the attempt read has since been accepted',
                async () => {
                    const seen = await DispatchRecord.read(claimCheckNumber, phoneNumber);

                    await DispatchRecord.accept(claimCheckNumber, phoneNumber, sid);

                    return seen;
                },
            ],
        ])('should back off, writing nothing, when %s', async (_, arrange) => {
            await DispatchRecord.begin(claimCheckNumber, phoneNumber, 'first', null);
            const seen = await arrange();
            const before = store.get(key);

            await expect(
                DispatchRecord.begin(claimCheckNumber, phoneNumber, 'second', seen),
            ).resolves.toBe(false);
            expect(store.get(key)).toBe(before);
        });

        it('should reject when the attempt cannot be recorded', async () => {
            cache.eval.mockRejectedValueOnce(new Error('down'));

            await expect(
                DispatchRecord.begin(claimCheckNumber, phoneNumber, 'hello', null),
            ).rejects.toThrow('down');
        });

        it('should reject once it outlasts the slot timeout', async () => {
            vi.useFakeTimers();
            cache.eval.mockReturnValueOnce(new Promise(() => {}));

            const beginning = DispatchRecord.begin(claimCheckNumber, phoneNumber, 'hello', null);
            const settled = expect(beginning).rejects.toThrow(
                `${DISPATCH_RECORD_SLOT_TIMEOUT_MS}ms`,
            );

            await vi.advanceTimersByTimeAsync(DISPATCH_RECORD_SLOT_TIMEOUT_MS);
            await settled;
        });

        it('should send with the slot timeout so an unsent one is dropped', async () => {
            await DispatchRecord.begin(claimCheckNumber, phoneNumber, 'hello', null);

            expect(cache.eval.mock.contexts[0]).toEqual(
                expect.objectContaining({ options: { timeout: DISPATCH_RECORD_SLOT_TIMEOUT_MS } }),
            );
        });
    });

    describe('accept', () => {
        it('should replace the attempt with the accepted SID', async () => {
            await DispatchRecord.begin(claimCheckNumber, phoneNumber, 'hello', null);
            await DispatchRecord.accept(claimCheckNumber, phoneNumber, sid);

            await expect(DispatchRecord.read(claimCheckNumber, phoneNumber)).resolves.toEqual({
                state: 'accepted',
                sid,
            });
            expect(cache.set).toHaveBeenLastCalledWith(key, expect.any(String), {
                EX: DISPATCH_RECORD_TTL_SECONDS,
            });
        });

        it('should resolve and log when the SID cannot be recorded', async () => {
            cache.set.mockRejectedValueOnce(new Error('down'));

            await expect(
                DispatchRecord.accept(claimCheckNumber, phoneNumber, sid),
            ).resolves.toBeUndefined();
            expect(log.warn).toHaveBeenCalledWith(
                expect.objectContaining({ claimCheckNumber, phoneNumber, sid }),
                expect.any(String),
            );
        });

        it('should resolve once it outlasts its timeout', async () => {
            vi.useFakeTimers();
            cache.set.mockReturnValueOnce(new Promise(() => {}));

            const accepting = DispatchRecord.accept(claimCheckNumber, phoneNumber, sid);

            await vi.advanceTimersByTimeAsync(DISPATCH_RECORD_TIMEOUT_MS);
            await expect(accepting).resolves.toBeUndefined();
        });
    });

    describe('forget', () => {
        it('should drop the record', async () => {
            await DispatchRecord.begin(claimCheckNumber, phoneNumber, 'hello', null);
            await DispatchRecord.forget(claimCheckNumber, phoneNumber);

            await expect(DispatchRecord.read(claimCheckNumber, phoneNumber)).resolves.toBeNull();
        });

        it('should resolve and log when the record cannot be dropped', async () => {
            cache.del.mockRejectedValueOnce(new Error('down'));

            await expect(
                DispatchRecord.forget(claimCheckNumber, phoneNumber),
            ).resolves.toBeUndefined();
            expect(log.warn).toHaveBeenCalledWith(
                expect.objectContaining({ claimCheckNumber, phoneNumber }),
                expect.any(String),
            );
        });
    });
});
