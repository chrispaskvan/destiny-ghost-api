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
    getUserByPhoneNumber: vi.fn(),
};

beforeEach(() => {
    vi.clearAllMocks();
});

describe('mayDeliver', () => {
    it('should read through to Cosmos rather than the cache', async () => {
        users.getUserByPhoneNumber.mockResolvedValue({ phoneNumber });

        await mayDeliver({ users, phoneNumber });

        expect(users.getUserByPhoneNumber).toHaveBeenCalledWith(phoneNumber, true);
    });

    it('should allow a subscribed user', async () => {
        users.getUserByPhoneNumber.mockResolvedValue({ phoneNumber, isSubscribed: true });

        await expect(mayDeliver({ users, phoneNumber })).resolves.toBe(true);
    });

    it('should allow a user whose document predates isSubscribed', async () => {
        users.getUserByPhoneNumber.mockResolvedValue({ phoneNumber });

        await expect(mayDeliver({ users, phoneNumber })).resolves.toBe(true);
    });

    it('should suppress when the user has opted out', async () => {
        users.getUserByPhoneNumber.mockResolvedValue({ phoneNumber, isSubscribed: false });

        await expect(mayDeliver({ users, phoneNumber })).resolves.toBe(false);
    });

    it('should suppress when no account exists for the number', async () => {
        users.getUserByPhoneNumber.mockResolvedValue(undefined);

        await expect(mayDeliver({ users, phoneNumber })).resolves.toBe(false);
    });

    it('should suppress when consent storage is unavailable', async () => {
        users.getUserByPhoneNumber.mockRejectedValue(new Error('Cosmos is down'));

        await expect(mayDeliver({ users, phoneNumber })).resolves.toBe(false);
    });

    describe('vendor preferences', () => {
        it('should suppress when the sender disabled that vendor', async () => {
            users.getUserByPhoneNumber.mockResolvedValue({
                phoneNumber,
                isSubscribed: true,
                notifications: [{ type: notificationTypes.Xur, enabled: false }],
            });

            await expect(
                mayDeliver({ users, phoneNumber, notificationType: notificationTypes.Xur }),
            ).resolves.toBe(false);
        });

        it('should leave unrelated vendors enabled when one is disabled', async () => {
            users.getUserByPhoneNumber.mockResolvedValue({
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
            users.getUserByPhoneNumber.mockResolvedValue({
                phoneNumber,
                isSubscribed: true,
                notifications: [{ type: notificationTypes.IronBanner, enabled: true }],
            });

            await expect(
                mayDeliver({ users, phoneNumber, notificationType: notificationTypes.Xur }),
            ).resolves.toBe(true);
        });

        it('should ignore vendor preferences when no type is given', async () => {
            users.getUserByPhoneNumber.mockResolvedValue({
                phoneNumber,
                isSubscribed: true,
                notifications: [{ type: notificationTypes.Xur, enabled: false }],
            });

            await expect(mayDeliver({ users, phoneNumber })).resolves.toBe(true);
        });

        it('should still suppress a disabled vendor for an opted-out user', async () => {
            users.getUserByPhoneNumber.mockResolvedValue({
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
