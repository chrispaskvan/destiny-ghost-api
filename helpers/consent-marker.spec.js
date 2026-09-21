import { beforeEach, describe, expect, it, vi } from 'vitest';
import Chance from 'chance';
import cache from './cache.js';
import mayDeliver from './consent.js';
import {
    recordConsent,
    readConsent,
    CONSENT_MARKER_TTL_SECONDS,
    RECORD_CONSENT,
} from './consent-marker.js';

vi.mock('./cache.js', () => ({
    default: {
        eval: vi.fn(),
        hGetAll: vi.fn(),
    },
}));
vi.mock('./log.js', () => ({
    default: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

const chance = new Chance();
const phoneNumber = chance.phone();
const receivedAt = 1_700_000_000_000;

/**
 * Stands in for the Lua above, so the reordering cases below can be driven
 * through the real `recordConsent`/`readConsent` pair.
 *
 * It mirrors the script rather than running it: Redis executes the real one,
 * and nothing here proves that body is correct. What these tests do cover is
 * that `receivedAt` reaches the script as the value it compares on, and that
 * the two functions agree on how a marker is stored and read back. The
 * atomicity itself is Redis's to keep.
 */
const fakeRedis = () => {
    /** @type {Map<string, Record<string, string>>} */
    const store = new Map();

    return {
        store,
        eval: vi.fn(async (_script, { keys: [key], arguments: [isSubscribed, stamp] }) => {
            const current = store.get(key);

            if (current && Number(current.receivedAt) > Number(stamp)) {
                return 0;
            }

            store.set(key, { isSubscribed, receivedAt: stamp });

            return 1;
        }),
        hGetAll: vi.fn(async key => store.get(key) ?? {}),
    };
};

beforeEach(() => {
    vi.clearAllMocks();
    cache.eval.mockResolvedValue(1);
    cache.hGetAll.mockResolvedValue({});
});

describe('recordConsent', () => {
    it('should compare on the arrival stamp rather than overwriting blindly', async () => {
        await recordConsent(phoneNumber, false, receivedAt);

        expect(cache.eval).toHaveBeenCalledWith(RECORD_CONSENT, {
            keys: [`consent:${phoneNumber}`],
            arguments: ['0', String(receivedAt), String(CONSENT_MARKER_TTL_SECONDS)],
        });
    });

    /**
     * The only assertion here that touches the script body. Redis runs the
     * Lua, nothing in this file does, so the reordering tests below cannot
     * tell a guarded script from an unguarded one - they drive a double that
     * mirrors it. This pins the guard so it cannot be dropped silently; that
     * it is *correct* rests on review, and on Redis running it atomically.
     */
    it('should decline inside the script rather than trusting the caller to order writes', () => {
        const script = RECORD_CONSENT.replace(/\s+/g, ' ');

        expect(script).toContain("redis.call('HGET', KEYS[1], 'receivedAt')");
        expect(script).toContain(
            'if current and tonumber(current) > tonumber(ARGV[2]) then return 0',
        );
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
    it('should not reject when the write fails', async () => {
        cache.eval.mockRejectedValue(new Error('Redis is down'));

        await expect(recordConsent(phoneNumber, false, receivedAt)).resolves.toBeUndefined();
    });

    it('should not wait indefinitely on a client that never settles', async () => {
        cache.eval.mockReturnValue(new Promise(() => {}));

        await expect(recordConsent(phoneNumber, false, receivedAt)).resolves.toBeUndefined();
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

    /**
     * This read is the delivery gate's guard, which runs inside a rate limiter
     * slot that is `maxConcurrent: 1` cluster-wide. A read that never settles
     * would not stall one send; it would hold the only slot and stall every
     * outbound message. node-redis queues commands while it reconnects, so
     * that is a dropped connection away rather than hypothetical.
     */
    it('should give up rather than hold the limiter slot when the client never settles', async () => {
        cache.hGetAll.mockReturnValue(new Promise(() => {}));

        await expect(readConsent(phoneNumber)).resolves.toBeUndefined();
    });
});

/**
 * The seam the other specs cannot see: `consent.spec.js` mocks this module and
 * this file's own tests stop at its boundary, so nothing otherwise exercises a
 * marker being written by one function and acted on by the gate. Real marker,
 * real gate, fake Redis, stubbed documents.
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

describe('when two acknowledgements for one number race', () => {
    /** @type {ReturnType<typeof fakeRedis>} */
    let redis;

    beforeEach(() => {
        redis = fakeRedis();
        cache.eval.mockImplementation(redis.eval);
        cache.hGetAll.mockImplementation(redis.hGetAll);
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
