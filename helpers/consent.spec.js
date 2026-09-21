import { beforeEach, describe, expect, it, vi } from 'vitest';
import Chance from 'chance';
import mayDeliver from './consent.js';
import notificationTypes from '../notifications/notification.types.js';

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
});

describe('mayDeliver', () => {
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
