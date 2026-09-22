import { beforeEach, describe, expect, it, vi } from 'vitest';
import Chance from 'chance';
import mayDeliver from './consent.js';
import { readConsent } from './consent-marker.js';
import notificationTypes from '../notifications/notification.types.js';

vi.mock('./consent-marker.js', () => ({
    readConsent: vi.fn(),
}));
vi.mock('./log.js', () => ({
    default: {
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
    },
}));

const chance = new Chance();
const phoneNumber = chance.phone();
const users = {
    getConsentByPhoneNumber: vi.fn(),
};

beforeEach(() => {
    vi.clearAllMocks();
    // Default: nothing acknowledged but unwritten, so Cosmos decides.
    readConsent.mockResolvedValue(undefined);
});

describe('mayDeliver', () => {
    describe('when an acknowledged change has not been written yet', () => {
        const receivedAt = 1_700_000_000_000;

        it('should suppress on a pending STOP the stored document has not caught up with', async () => {
            users.getConsentByPhoneNumber.mockResolvedValue({
                isSubscribed: true,
                consentUpdatedAt: receivedAt - 1000,
            });
            readConsent.mockResolvedValue({ isSubscribed: false, receivedAt });

            await expect(mayDeliver({ users, phoneNumber })).resolves.toBe(false);
        });

        it('should deliver on a pending START that outranks a stored opt-out', async () => {
            users.getConsentByPhoneNumber.mockResolvedValue({
                isSubscribed: false,
                consentUpdatedAt: receivedAt - 1000,
            });
            readConsent.mockResolvedValue({ isSubscribed: true, receivedAt });

            await expect(mayDeliver({ users, phoneNumber })).resolves.toBe(true);
        });

        /**
         * `applyConsent` applies on a tie, so once the write lands the stamps
         * match and the marker has nothing left to say. This is what keeps it
         * from stranding anyone rather than its expiry.
         */
        it('should ignore a marker the stored document has caught up with', async () => {
            users.getConsentByPhoneNumber.mockResolvedValue({
                isSubscribed: true,
                consentUpdatedAt: receivedAt,
            });
            readConsent.mockResolvedValue({ isSubscribed: false, receivedAt });

            await expect(mayDeliver({ users, phoneNumber })).resolves.toBe(true);
        });

        it('should ignore a marker the stored document has overtaken', async () => {
            users.getConsentByPhoneNumber.mockResolvedValue({
                isSubscribed: true,
                consentUpdatedAt: receivedAt + 1000,
            });
            readConsent.mockResolvedValue({ isSubscribed: false, receivedAt });

            await expect(mayDeliver({ users, phoneNumber })).resolves.toBe(true);
        });

        it('should honour a pending STOP against a document with no stamp at all', async () => {
            users.getConsentByPhoneNumber.mockResolvedValue({ isSubscribed: true });
            readConsent.mockResolvedValue({ isSubscribed: false, receivedAt });

            await expect(mayDeliver({ users, phoneNumber })).resolves.toBe(false);
        });

        it('should still suppress when a pending START has no account behind it', async () => {
            users.getConsentByPhoneNumber.mockResolvedValue(undefined);
            readConsent.mockResolvedValue({ isSubscribed: true, receivedAt });

            await expect(mayDeliver({ users, phoneNumber })).resolves.toBe(false);
        });

        it('should read the marker and the document together, not in sequence', async () => {
            let documentSettled = false;

            users.getConsentByPhoneNumber.mockImplementation(async () => {
                documentSettled = true;

                return { isSubscribed: true };
            });
            readConsent.mockImplementation(async () => {
                expect(documentSettled).toBe(false);

                return undefined;
            });

            await mayDeliver({ users, phoneNumber });

            expect(readConsent).toHaveBeenCalledWith(phoneNumber);
        });
    });

    it('should read the consent projection rather than the whole user', async () => {
        users.getConsentByPhoneNumber.mockResolvedValue({ isSubscribed: true });

        await mayDeliver({ users, phoneNumber });

        expect(users.getConsentByPhoneNumber).toHaveBeenCalledWith(phoneNumber);
    });

    it('should allow a subscribed user', async () => {
        users.getConsentByPhoneNumber.mockResolvedValue({ phoneNumber, isSubscribed: true });

        await expect(mayDeliver({ users, phoneNumber })).resolves.toBe(true);
    });

    it('should allow a user whose document predates isSubscribed', async () => {
        users.getConsentByPhoneNumber.mockResolvedValue({ phoneNumber });

        await expect(mayDeliver({ users, phoneNumber })).resolves.toBe(true);
    });

    it('should suppress when the user has opted out', async () => {
        users.getConsentByPhoneNumber.mockResolvedValue({ phoneNumber, isSubscribed: false });

        await expect(mayDeliver({ users, phoneNumber })).resolves.toBe(false);
    });

    it('should suppress when no account exists for the number', async () => {
        users.getConsentByPhoneNumber.mockResolvedValue(undefined);

        await expect(mayDeliver({ users, phoneNumber })).resolves.toBe(false);
    });

    it('should suppress when consent storage is unavailable', async () => {
        users.getConsentByPhoneNumber.mockRejectedValue(new Error('Cosmos is down'));

        await expect(mayDeliver({ users, phoneNumber })).resolves.toBe(false);
    });

    describe('vendor preferences', () => {
        it('should suppress when the sender disabled that vendor', async () => {
            users.getConsentByPhoneNumber.mockResolvedValue({
                phoneNumber,
                isSubscribed: true,
                notifications: [{ type: notificationTypes.Xur, enabled: false }],
            });

            await expect(
                mayDeliver({ users, phoneNumber, notificationType: notificationTypes.Xur }),
            ).resolves.toBe(false);
        });

        it('should leave unrelated vendors enabled when one is disabled', async () => {
            users.getConsentByPhoneNumber.mockResolvedValue({
                phoneNumber,
                isSubscribed: true,
                notifications: [
                    { type: notificationTypes.Xur, enabled: false },
                    { type: notificationTypes.IronBanner, enabled: true },
                ],
            });

            await expect(
                mayDeliver({ users, phoneNumber, notificationType: notificationTypes.IronBanner }),
            ).resolves.toBe(true);
        });

        it('should allow when the user has no entry for that vendor', async () => {
            users.getConsentByPhoneNumber.mockResolvedValue({
                phoneNumber,
                isSubscribed: true,
                notifications: [{ type: notificationTypes.IronBanner, enabled: true }],
            });

            await expect(
                mayDeliver({ users, phoneNumber, notificationType: notificationTypes.Xur }),
            ).resolves.toBe(true);
        });

        it('should ignore vendor preferences when no type is given', async () => {
            users.getConsentByPhoneNumber.mockResolvedValue({
                phoneNumber,
                isSubscribed: true,
                notifications: [{ type: notificationTypes.Xur, enabled: false }],
            });

            await expect(mayDeliver({ users, phoneNumber })).resolves.toBe(true);
        });

        it('should still suppress a disabled vendor for an opted-out user', async () => {
            users.getConsentByPhoneNumber.mockResolvedValue({
                phoneNumber,
                isSubscribed: false,
                notifications: [{ type: notificationTypes.Xur, enabled: true }],
            });

            await expect(
                mayDeliver({ users, phoneNumber, notificationType: notificationTypes.Xur }),
            ).resolves.toBe(false);
        });
    });
});
