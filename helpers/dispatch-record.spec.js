import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import DispatchRecord, {
    DISPATCH_RECORD_SLOT_TIMEOUT_MS,
    DISPATCH_RECORD_TIMEOUT_MS,
    DISPATCH_RECORD_TTL_SECONDS,
} from './dispatch-record.js';
import cache from './cache.js';
import log from './log.js';

vi.mock('./cache.js', () => ({
    default: {
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
        cache.withCommandOptions.mockImplementation(options => ({
            options,
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

            await DispatchRecord.begin(claimCheckNumber, phoneNumber, 'hello');

            expect(cache.set).toHaveBeenCalledWith(key, expect.any(String), {
                EX: DISPATCH_RECORD_TTL_SECONDS,
            });
            await expect(DispatchRecord.read(claimCheckNumber, phoneNumber)).resolves.toEqual({
                state: 'attempting',
                at: 1_000,
                body: 'hello',
            });
        });

        it('should reject when the attempt cannot be recorded', async () => {
            cache.set.mockRejectedValueOnce(new Error('down'));

            await expect(
                DispatchRecord.begin(claimCheckNumber, phoneNumber, 'hello'),
            ).rejects.toThrow('down');
        });

        it('should reject once it outlasts the slot timeout', async () => {
            vi.useFakeTimers();
            cache.set.mockReturnValueOnce(new Promise(() => {}));

            const beginning = DispatchRecord.begin(claimCheckNumber, phoneNumber, 'hello');
            const settled = expect(beginning).rejects.toThrow(
                `${DISPATCH_RECORD_SLOT_TIMEOUT_MS}ms`,
            );

            await vi.advanceTimersByTimeAsync(DISPATCH_RECORD_SLOT_TIMEOUT_MS);
            await settled;
        });

        it('should send with the slot timeout so an unsent one is dropped', async () => {
            await DispatchRecord.begin(claimCheckNumber, phoneNumber, 'hello');

            expect(cache.set.mock.contexts[0]).toEqual(
                expect.objectContaining({ options: { timeout: DISPATCH_RECORD_SLOT_TIMEOUT_MS } }),
            );
        });
    });

    describe('accept', () => {
        it('should replace the attempt with the accepted SID', async () => {
            await DispatchRecord.begin(claimCheckNumber, phoneNumber, 'hello');
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
            await DispatchRecord.begin(claimCheckNumber, phoneNumber, 'hello');
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
