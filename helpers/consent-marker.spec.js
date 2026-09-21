import { beforeEach, describe, expect, it, vi } from 'vitest';
import Chance from 'chance';
import cache from './cache.js';
import { recordConsent, readConsent, CONSENT_MARKER_TTL_SECONDS } from './consent-marker.js';

vi.mock('./cache.js', () => ({
    default: {
        set: vi.fn(),
        get: vi.fn(),
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
    cache.set.mockResolvedValue('OK');
    cache.get.mockResolvedValue(null);
});

describe('recordConsent', () => {
    it('should store the intent and its arrival time under the number', async () => {
        await recordConsent(phoneNumber, false, receivedAt);

        expect(cache.set).toHaveBeenCalledWith(
            `consent:${phoneNumber}`,
            JSON.stringify({ isSubscribed: false, receivedAt }),
            { EX: CONSENT_MARKER_TTL_SECONDS },
        );
    });

    /**
     * Carrier compliance rides on the reply going out. A marker that cannot be
     * written leaves the window where it was; failing the reply would be worse
     * than leaving it open.
     */
    it('should not reject when the write fails', async () => {
        cache.set.mockRejectedValue(new Error('Redis is down'));

        await expect(recordConsent(phoneNumber, false, receivedAt)).resolves.toBeUndefined();
    });

    it('should not wait indefinitely on a client that never settles', async () => {
        cache.set.mockReturnValue(new Promise(() => {}));

        await expect(recordConsent(phoneNumber, false, receivedAt)).resolves.toBeUndefined();
    });
});

describe('readConsent', () => {
    it('should return the stored intent', async () => {
        cache.get.mockResolvedValue(JSON.stringify({ isSubscribed: false, receivedAt }));

        await expect(readConsent(phoneNumber)).resolves.toEqual({
            isSubscribed: false,
            receivedAt,
        });
    });

    it('should return undefined when nothing is held for the number', async () => {
        await expect(readConsent(phoneNumber)).resolves.toBeUndefined();
    });

    it('should report a failed read as absent rather than rejecting', async () => {
        cache.get.mockRejectedValue(new Error('Redis is down'));

        await expect(readConsent(phoneNumber)).resolves.toBeUndefined();
    });

    it('should report unreadable contents as absent rather than rejecting', async () => {
        cache.get.mockResolvedValue('not json');

        await expect(readConsent(phoneNumber)).resolves.toBeUndefined();
    });
});
