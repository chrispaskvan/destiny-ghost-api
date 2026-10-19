import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import DispatchRecord, {
    DISPATCH_RECORD_TIMEOUT_MS,
    DISPATCH_RECORD_TTL_SECONDS,
    REPLACE,
} from './dispatch-record.js';
import cache from './cache.js';
import log from './log.js';

vi.mock('./cache.js', () => ({
    default: {
        eval: vi.fn(),
        get: vi.fn(),
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
    const read = () => DispatchRecord.read(claimCheckNumber, phoneNumber);
    const begin = (body, seen = null) =>
        DispatchRecord.begin(claimCheckNumber, phoneNumber, body, seen);

    beforeEach(() => {
        store = new Map();
        cache.get.mockImplementation(async k => store.get(k) ?? null);
        /**
         * A mirror of `REPLACE`, which Redis runs for real: it covers how the
         * module calls the script and reads its answer, not the script.
         */
        cache.eval.mockImplementation(
            async (script, { keys: [k], arguments: [expected, replacement] }) => {
                expect(script).toBe(REPLACE);
                if ((store.get(k) ?? '') !== expected) return 0;
                if (replacement === '') store.delete(k);
                else store.set(k, replacement);
                return 1;
            },
        );
        cache.withCommandOptions.mockImplementation(options => ({
            options,
            eval: cache.eval,
            get: cache.get,
        }));
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    describe('read', () => {
        it('should find nothing for a send never begun', async () => {
            await expect(read()).resolves.toBeNull();
        });

        it('should reject when the record cannot be read', async () => {
            cache.get.mockRejectedValueOnce(new Error('down'));

            await expect(read()).rejects.toThrow('down');
        });

        it('should reject once the read outlasts its timeout', async () => {
            vi.useFakeTimers();
            cache.get.mockReturnValueOnce(new Promise(() => {}));

            const settled = expect(read()).rejects.toThrow(`${DISPATCH_RECORD_TIMEOUT_MS}ms`);

            await vi.advanceTimersByTimeAsync(DISPATCH_RECORD_TIMEOUT_MS);
            await settled;
        });

        it('should send with a timeout that drops it if still unsent', async () => {
            await read();

            expect(cache.get.mock.contexts[0]).toEqual(
                expect.objectContaining({ options: { timeout: DISPATCH_RECORD_TIMEOUT_MS } }),
            );
        });
    });

    describe('begin', () => {
        it('should record the attempt, with what was sent and when, and return it', async () => {
            vi.useFakeTimers({ now: 1_000 });

            const mine = await begin('hello');

            expect(mine).toEqual({ state: 'attempting', at: 1_000, body: 'hello' });
            expect(cache.eval).toHaveBeenCalledWith(REPLACE, {
                keys: [key],
                arguments: ['', JSON.stringify(mine), String(DISPATCH_RECORD_TTL_SECONDS)],
            });
            await expect(read()).resolves.toEqual(mine);
        });

        it('should take over an attempt that is still what was read', async () => {
            await begin('first');

            await expect(begin('second', await read())).resolves.toMatchObject({
                body: 'second',
            });
            await expect(read()).resolves.toMatchObject({ body: 'second' });
        });

        it.each([
            ['another attempt began since nothing was read', async () => null],
            [
                'the attempt read has since been accepted',
                async () => {
                    const seen = await read();

                    await DispatchRecord.accept(claimCheckNumber, phoneNumber, sid, seen);

                    return seen;
                },
            ],
        ])('should back off, writing nothing, when %s', async (_, arrange) => {
            await begin('first');
            const seen = await arrange();
            const before = store.get(key);

            await expect(begin('second', seen)).resolves.toBeNull();
            expect(store.get(key)).toBe(before);
        });

        it('should reject when the attempt cannot be recorded', async () => {
            cache.eval.mockRejectedValueOnce(new Error('down'));

            await expect(begin('hello')).rejects.toThrow('down');
        });

        it('should reject once it outlasts its timeout', async () => {
            vi.useFakeTimers();
            cache.eval.mockReturnValueOnce(new Promise(() => {}));

            const settled = expect(begin('hello')).rejects.toThrow(
                `${DISPATCH_RECORD_TIMEOUT_MS}ms`,
            );

            await vi.advanceTimersByTimeAsync(DISPATCH_RECORD_TIMEOUT_MS);
            await settled;
        });

        it('should send with a timeout that drops it if still unsent', async () => {
            await begin('hello');

            expect(cache.eval.mock.contexts[0]).toEqual(
                expect.objectContaining({ options: { timeout: DISPATCH_RECORD_TIMEOUT_MS } }),
            );
        });
    });

    describe('forget', () => {
        it('should let a later attempt begin as if none had been made', async () => {
            const mine = await begin('hello');

            await DispatchRecord.forget(claimCheckNumber, phoneNumber, mine);

            expect(store.has(key)).toBe(false);
            await expect(begin('again', null)).resolves.toMatchObject({ body: 'again' });
        });
    });

    /**
     * Each write after the send replaces only the record its attempt wrote,
     * so a copy of the job that took over since keeps its own.
     */
    describe.each([
        [
            'accept',
            mine => DispatchRecord.accept(claimCheckNumber, phoneNumber, sid, mine),
            () => ({ state: 'accepted', sid }),
        ],
        [
            'unsettled',
            mine => DispatchRecord.unsettled(claimCheckNumber, phoneNumber, mine),
            mine => ({ ...mine, failedAt: 2_000 }),
        ],
        ['forget', mine => DispatchRecord.forget(claimCheckNumber, phoneNumber, mine), () => null],
    ])('%s', (_, write, expected) => {
        it('should replace the record this attempt wrote', async () => {
            vi.useFakeTimers({ now: 1_000 });
            const mine = await begin('hello');

            vi.setSystemTime(2_000);
            await expect(write(mine)).resolves.toBe(true);

            await expect(read()).resolves.toEqual(expected(mine));
        });

        it('should leave a record another attempt wrote since', async () => {
            const mine = await begin('hello');
            const theirs = await begin('again', mine);

            await expect(write(mine)).resolves.toBe(false);

            await expect(read()).resolves.toEqual(theirs);
        });

        it('should resolve and log when it cannot write', async () => {
            const mine = await begin('hello');

            cache.eval.mockRejectedValueOnce(new Error('down'));

            await expect(write(mine)).resolves.toBe(false);
            expect(log.warn).toHaveBeenCalledWith(
                expect.objectContaining({ claimCheckNumber, phoneNumber }),
                expect.any(String),
            );
        });

        it('should resolve once it outlasts its timeout', async () => {
            const mine = await begin('hello');

            vi.useFakeTimers();
            cache.eval.mockReturnValueOnce(new Promise(() => {}));

            const writing = write(mine);

            await vi.advanceTimersByTimeAsync(DISPATCH_RECORD_TIMEOUT_MS);
            await expect(writing).resolves.toBe(false);
        });
    });
});
