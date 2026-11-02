import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Chance from 'chance';
import { fakeRedis } from '../vitest.redis-lua.js';
import cache from './cache.js';
import mayDeliver from './consent.js';
import log from './log.js';
import {
    recordConsent,
    readConsent,
    CONSENT_MARKER_READ_TIMEOUT_MS,
    CONSENT_MARKER_TTL_SECONDS,
    CONSENT_MARKER_WRITE_TIMEOUT_MS,
    RECORD_CONSENT,
} from './consent-marker.js';

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

const chance = new Chance();
const phoneNumber = chance.phone();
const receivedAt = 1_700_000_000_000;

beforeEach(() => {
    vi.clearAllMocks();
    cache.eval.mockResolvedValue(1);
    cache.hGetAll.mockResolvedValue({});
    /**
     * The client with command options, which only the read asks for: the
     * write keeps its command and goes on the bare client. Looked up on each
     * call, so a test that swaps in a fake Redis below reaches it through
     * here too.
     */
    cache.withCommandOptions.mockImplementation(options => ({
        options,
        hGetAll: vi.fn((...args) => cache.hGetAll(...args)),
    }));
});

afterEach(() => {
    vi.useRealTimers();
});

describe('recordConsent', () => {
    it('should compare on the arrival stamp rather than overwriting blindly', async () => {
        await recordConsent(phoneNumber, false, receivedAt);

        expect(cache.eval).toHaveBeenCalledWith(RECORD_CONSENT, {
            keys: [`consent:${phoneNumber}`],
            arguments: ['0', String(receivedAt), String(CONSENT_MARKER_TTL_SECONDS)],
        });
    });

    it('should record a START as the opposite intent', async () => {
        await recordConsent(phoneNumber, true, receivedAt);

        expect(cache.eval.mock.calls[0][1].arguments[0]).toBe('1');
    });

    /**
     * Carrier compliance rides on the reply going out. A marker that cannot be
     * written leaves the window where it was; failing the reply would be worse
     * than leaving it open.
     */
    it('should not reject when the write fails, warning that it did', async () => {
        cache.eval.mockRejectedValue(new Error('Redis is down'));

        await expect(recordConsent(phoneNumber, false, receivedAt)).resolves.toBeUndefined();
        expect(log.warn).toHaveBeenCalledOnce();
    });

    /**
     * A write still queued is not a failure: it lands when Redis is back.
     * Only one that then fails is - and that is the one worth a warning.
     */
    it.each([
        ['lands', false],
        ['then fails', true],
    ])(
        'should report a queued write that %s as still queued, warning only on failure',
        async (_, fails) => {
            vi.useFakeTimers();
            let settle;

            cache.eval.mockReturnValue(
                new Promise((resolve, reject) => {
                    settle = () => (fails ? reject(new Error('client closed')) : resolve(1));
                }),
            );

            const recording = recordConsent(phoneNumber, false, receivedAt);

            await vi.advanceTimersByTimeAsync(CONSENT_MARKER_WRITE_TIMEOUT_MS);
            await expect(recording).resolves.toBeUndefined();
            expect(log.info).toHaveBeenCalledWith(
                expect.objectContaining({ phoneNumber }),
                expect.stringContaining('still queued'),
            );
            expect(log.warn).not.toHaveBeenCalled();

            settle();
            await vi.advanceTimersByTimeAsync(0);

            expect(log.warn).toHaveBeenCalledTimes(fails ? 1 : 0);
        },
    );

    /**
     * Not a path node-redis takes today - a closed client rejects rather than
     * throwing, and its synchronous throw is in the MULTI code. But
     * `request()` awaits this before answering a STOP, so the contract has to
     * hold because of how this is written, not because of how a dependency
     * behaves this release.
     */
    it('should not reject when the client raises synchronously', async () => {
        cache.eval.mockImplementation(() => {
            throw new Error('the client is closed');
        });

        await expect(recordConsent(phoneNumber, false, receivedAt)).resolves.toBeUndefined();
    });

    it('should give up, still resolving, once the bound passes', async () => {
        vi.useFakeTimers();
        cache.eval.mockReturnValue(new Promise(() => {}));
        let settled = false;

        recordConsent(phoneNumber, false, receivedAt).then(() => {
            settled = true;
        });

        await vi.advanceTimersByTimeAsync(CONSENT_MARKER_WRITE_TIMEOUT_MS - 1);
        expect(settled).toBe(false);
        await vi.advanceTimersByTimeAsync(1);
        expect(settled).toBe(true);
    });

    /**
     * A STOP queued while Redis reconnects must still be written when it
     * comes back, ahead of the rate limiter's commands on the same client:
     * sent with a command timeout, node-redis would drop it instead, and a
     * send right after the reconnect could miss it.
     */
    it('should keep the write queued rather than dropping it if still unsent', async () => {
        await recordConsent(phoneNumber, false, receivedAt);

        expect(cache.withCommandOptions).not.toHaveBeenCalled();
        expect(cache.eval).toHaveBeenCalledOnce();
    });
});

describe('readConsent', () => {
    it('should return the stored intent', async () => {
        cache.hGetAll.mockResolvedValue({ isSubscribed: '0', receivedAt: String(receivedAt) });

        await expect(readConsent(phoneNumber)).resolves.toEqual({
            isSubscribed: false,
            receivedAt,
        });
    });

    it('should return undefined when nothing is held for the number', async () => {
        await expect(readConsent(phoneNumber)).resolves.toBeUndefined();
    });

    it('should report a failed read as absent rather than rejecting', async () => {
        cache.hGetAll.mockRejectedValue(new Error('Redis is down'));

        await expect(readConsent(phoneNumber)).resolves.toBeUndefined();
    });

    it('should report a read that throws as absent rather than rejecting', async () => {
        cache.hGetAll.mockImplementation(() => {
            throw new Error('the client is closed');
        });

        await expect(readConsent(phoneNumber)).resolves.toBeUndefined();
    });

    /**
     * This read is the delivery gate's guard, which holds up the send it
     * guards. node-redis queues commands while it reconnects, so a read that
     * never settles is a dropped connection away rather than hypothetical.
     */
    it('should give up, reporting absent, once the bound passes', async () => {
        vi.useFakeTimers();
        cache.hGetAll.mockReturnValue(new Promise(() => {}));

        let result = 'pending';

        readConsent(phoneNumber).then(marker => {
            result = marker;
        });

        await vi.advanceTimersByTimeAsync(CONSENT_MARKER_READ_TIMEOUT_MS - 1);
        expect(result).toBe('pending');
        await vi.advanceTimersByTimeAsync(1);
        expect(result).toBeUndefined();
    });

    it('should send through a client that drops it if still unsent', async () => {
        await readConsent(phoneNumber);

        expect(cache.withCommandOptions).toHaveBeenCalledWith({
            timeout: CONSENT_MARKER_READ_TIMEOUT_MS,
        });
        expect(cache.withCommandOptions.mock.results[0].value.hGetAll).toHaveBeenCalledOnce();
    });
});

/**
 * The seam the other specs cannot see: `consent.spec.js` mocks this module and
 * this file's own tests stop at its boundary, so nothing otherwise exercises a
 * marker being written by one function and acted on by the gate. Real marker,
 * real gate, real `RECORD_CONSENT` on an in-memory Redis, stubbed documents.
 */
describe('with the delivery gate', () => {
    /** @type {ReturnType<typeof fakeRedis>} */
    let redis;
    const users = { getConsentByPhoneNumber: vi.fn() };

    beforeEach(() => {
        redis = fakeRedis();
        cache.eval.mockImplementation(redis.eval);
        cache.hGetAll.mockImplementation(redis.hGetAll);
    });

    it('should suppress a send once a STOP has been acknowledged', async () => {
        users.getConsentByPhoneNumber.mockResolvedValue({ isSubscribed: true });

        await expect(mayDeliver({ users, phoneNumber })).resolves.toBe(true);

        await recordConsent(phoneNumber, false, receivedAt);

        await expect(mayDeliver({ users, phoneNumber })).resolves.toBe(false);
    });

    it('should hand back to the stored document once the write has landed', async () => {
        await recordConsent(phoneNumber, false, receivedAt);
        // The durable write catches up, carrying the same stamp.
        users.getConsentByPhoneNumber.mockResolvedValue({
            isSubscribed: false,
            consentUpdatedAt: receivedAt,
        });

        await expect(mayDeliver({ users, phoneNumber })).resolves.toBe(false);

        // ...and a later START, still only acknowledged, outranks it again.
        await recordConsent(phoneNumber, true, receivedAt + 1000);

        await expect(mayDeliver({ users, phoneNumber })).resolves.toBe(true);
    });

    it('should not let an acknowledged STOP be undone by an older delayed START', async () => {
        users.getConsentByPhoneNumber.mockResolvedValue({ isSubscribed: true });

        await recordConsent(phoneNumber, false, receivedAt + 1000);
        await recordConsent(phoneNumber, true, receivedAt);

        await expect(mayDeliver({ users, phoneNumber })).resolves.toBe(false);
    });
});

/**
 * These run the real `RECORD_CONSENT` (#777), so they are what holds its
 * guard in place. Redis running it atomically is what makes the guard enough.
 */
describe('when two acknowledgements for one number race', () => {
    /** @type {ReturnType<typeof fakeRedis>} */
    let redis;

    beforeEach(() => {
        redis = fakeRedis();
        cache.eval.mockImplementation(redis.eval);
        cache.hGetAll.mockImplementation(redis.hGetAll);
    });

    it('should hold the marker for CONSENT_MARKER_TTL_SECONDS', async () => {
        await recordConsent(phoneNumber, false, receivedAt);

        expect(redis.ttl(`consent:${phoneNumber}`)).toBe(CONSENT_MARKER_TTL_SECONDS);
    });

    it('should keep the newer intent when an older write lands last', async () => {
        // The STOP arrived second but reaches Redis first.
        await recordConsent(phoneNumber, false, receivedAt + 1000);
        await recordConsent(phoneNumber, true, receivedAt);

        await expect(readConsent(phoneNumber)).resolves.toEqual({
            isSubscribed: false,
            receivedAt: receivedAt + 1000,
        });
    });

    it('should apply the newer intent when the writes land in order', async () => {
        await recordConsent(phoneNumber, true, receivedAt);
        await recordConsent(phoneNumber, false, receivedAt + 1000);

        await expect(readConsent(phoneNumber)).resolves.toEqual({
            isSubscribed: false,
            receivedAt: receivedAt + 1000,
        });
    });

    /**
     * Matching `applyConsent`: two messages sharing a millisecond cannot be
     * ordered by arrival, so the one that gets there later wins.
     */
    it('should apply a tie rather than keeping the first writer', async () => {
        await recordConsent(phoneNumber, true, receivedAt);
        await recordConsent(phoneNumber, false, receivedAt);

        await expect(readConsent(phoneNumber)).resolves.toEqual({
            isSubscribed: false,
            receivedAt,
        });
    });
});
