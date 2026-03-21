import {
    beforeEach, describe, expect, it, vi,
} from 'vitest';
import Chance from 'chance';
import publisher from '../helpers/publisher.js';
import subscriber from '../helpers/subscriber.js';
import NotificationController from './notification.controller.js';
import NotificationError from './notification.error.js';
import notificationTypes from './notification.types.js';
import ClaimCheck from '../helpers/claim-check.js';
import log from '../helpers/log.js';
import throttle from '../helpers/throttle.js';

vi.mock('bullmq', () => ({
    UnrecoverableError: class UnrecoverableError extends Error {
        constructor(message, options) {
            super(message, options);
            this.name = 'UnrecoverableError';
        }
    },
    Queue: class {
        add = vi.fn().mockResolvedValue('some-job');
        getJob = vi.fn();

        constructor() {}
    },
    QueueEvents: class {
        on = vi.fn();
    },
}));

vi.mock('../helpers/publisher.js');
vi.mock('../helpers/subscriber.js');
vi.mock('./notification.error.js');
vi.mock('../helpers/claim-check.js');
vi.mock('../helpers/log.js', () => ({
    default: {
        info: vi.fn(),
        error: vi.fn(),
    },
}));
vi.mock('../helpers/throttle.js');
vi.mock('../helpers/retry.js', async importOriginal => {
    const original = await importOriginal();
    return {
        ...original,
        isTransientError: vi.fn(),
    };
});
vi.mock('../destiny/destiny.error.js', async importOriginal => {
    const original = await importOriginal();
    return { default: original.default };
});

import { isTransientError } from '../helpers/retry.js';
import DestinyError from '../destiny/destiny.error.js';

const chance = new Chance();
const phoneNumber = chance.phone();
const membershipId = chance.guid();
const membershipType = 2;
const claimCheckNumber = chance.string({ length: 10 });
const accessToken = chance.string({ length: 20 });
const characterId = chance.guid();
const mockUser = {
    phoneNumber,
    membershipId,
    membershipType,
    bungie: { access_token: accessToken }
};
const mockCharacter = {
    characterId,
};
const mockItem = {
    hash: 123456,
    displayProperties: { name: 'Test Weapon' },
    itemCategoryHashes: [1] // Weapon category
};
const mockClaimCheck = {
    number: claimCheckNumber,
    addPhoneNumber: vi.fn(),
    updatePhoneNumber: vi.fn()
};
const authenticationService = {
    authenticate: vi.fn()
};
const destinyService = {
    getProfile: vi.fn(),
    getXur: vi.fn()
};
const notificationService = {
    sendMessage: vi.fn()
};
const userService = {
    getSubscribedUsers: vi.fn(),
    getUserByPhoneNumber: vi.fn()
};
const worldRepository = {
    getWeaponCategory: vi.fn(),
    getItemByHash: vi.fn()
};

let notificationController;

beforeEach(() => {
    vi.clearAllMocks();

    // Setup ClaimCheck mock
    ClaimCheck.mockImplementation(function () { return mockClaimCheck; });
    ClaimCheck.getClaimCheck = vi.fn();
    ClaimCheck.updatePhoneNumber = vi.fn();

    // Setup subscriber mock
    subscriber.listen = vi.fn();

    // Setup throttle mock
    throttle.mockImplementation(promises => Promise.all(promises));

    // Default: errors are not transient
    isTransientError.mockReturnValue(false);

    notificationController = new NotificationController({
        authenticationService,
        destinyService,
        notificationService,
        userService,
        worldRepository,
    });
});

describe('NotificationController', () => {
    describe('create', () => {
        describe('when phone number is provided', () => {
            it('should send notification to specific user and return claim check number', async () => {
                const subscription = notificationTypes.Xur;

                userService.getUserByPhoneNumber.mockResolvedValue(mockUser);
                publisher.sendNotification.mockResolvedValue();
                mockClaimCheck.addPhoneNumber.mockResolvedValue();

                const result = await notificationController.create(subscription, phoneNumber);

                expect(userService.getUserByPhoneNumber).toHaveBeenCalledWith(phoneNumber);
                expect(publisher.sendNotification).toHaveBeenCalledWith(mockUser, {
                    notificationType: subscription,
                    claimCheckNumber,
                });
                expect(mockClaimCheck.addPhoneNumber).toHaveBeenCalledWith(phoneNumber);
                expect(result).toBe(claimCheckNumber);
            });

            it('should throw NotificationError when user is not found', async () => {
                const subscription = notificationTypes.Xur;

                userService.getUserByPhoneNumber.mockResolvedValue(null);

                await expect(notificationController.create(subscription, phoneNumber))
                    .rejects.toThrow(NotificationError);

                expect(NotificationError).toHaveBeenCalledWith('user not found');
            });

            it('should throw NotificationError when user has no phone number', async () => {
                const subscription = notificationTypes.Xur;
                const userWithoutPhone = { ...mockUser, phoneNumber: null };

                userService.getUserByPhoneNumber.mockResolvedValue(userWithoutPhone);

                await expect(notificationController.create(subscription, phoneNumber))
                    .rejects.toThrow(NotificationError);
            });
        });

        describe('when phone number is not provided', () => {
            it('should send notifications to all subscribed users', async () => {
                const subscription = notificationTypes.Xur;
                const numberOfSubscribedUsers = 11;
                const subscribedUsers = new Array(numberOfSubscribedUsers).fill(mockUser);

                publisher.sendNotification.mockResolvedValue();
                userService.getSubscribedUsers.mockResolvedValue(subscribedUsers);
                mockClaimCheck.addPhoneNumber.mockResolvedValue();

                const result = await notificationController.create(subscription);

                expect(userService.getSubscribedUsers).toHaveBeenCalledWith(subscription);
                expect(throttle).toHaveBeenCalledWith(expect.any(Array), 2, 500);
                expect(result).toBe(claimCheckNumber);
            });
        });
    });

    describe('getClaimCheck', () => {
        it('should return claim check data for given number', async () => {
            const expectedClaimCheck = { number: claimCheckNumber, phoneNumbers: [phoneNumber] };

            ClaimCheck.getClaimCheck.mockResolvedValue(expectedClaimCheck);

            const result = await notificationController.getClaimCheck(claimCheckNumber);

            expect(ClaimCheck.getClaimCheck).toHaveBeenCalledWith(claimCheckNumber);
            expect(result).toEqual(expectedClaimCheck);
        });
    });

    describe('#send (private method via subscriber)', () => {
        let sendMethod;

        beforeEach(() => {
            // Extract the bound send method from the subscriber.listen call
            sendMethod = subscriber.listen.mock.calls[0][0];
        });

        describe('when notification type is Xur', () => {
            it('should send Xur inventory notification successfully', async () => {
                const weaponCategoryHash = 1;
                const itemHashes = [123456, 789012];

                authenticationService.authenticate.mockResolvedValue({ bungie: { access_token: accessToken } });
                destinyService.getProfile.mockResolvedValue([mockCharacter]);
                destinyService.getXur.mockResolvedValue(itemHashes);
                worldRepository.getWeaponCategory.mockResolvedValue(weaponCategoryHash);
                worldRepository.getItemByHash.mockResolvedValue(mockItem);
                notificationService.sendMessage.mockResolvedValue({ status: 'sent' });
                ClaimCheck.updatePhoneNumber.mockResolvedValue();

                await sendMethod(mockUser, {
                    claimCheckNumber,
                    notificationType: notificationTypes.Xur,
                });

                expect(authenticationService.authenticate).toHaveBeenCalledWith(mockUser);
                expect(destinyService.getProfile).toHaveBeenCalledWith(membershipId, membershipType);
                expect(destinyService.getXur).toHaveBeenCalledWith(
                    membershipId,
                    membershipType,
                    characterId,
                    accessToken
                );
                expect(worldRepository.getWeaponCategory).toHaveBeenCalled();
                expect(worldRepository.getItemByHash).toHaveBeenCalledTimes(itemHashes.length);
                expect(notificationService.sendMessage).toHaveBeenCalledWith(
                    'Test Weapon\nTest Weapon',
                    phoneNumber,
                    null,
                    { claimCheckNumber, notificationType: notificationTypes.Xur }
                );
                expect(ClaimCheck.updatePhoneNumber).toHaveBeenCalledWith(
                    claimCheckNumber,
                    phoneNumber,
                    'sent'
                );
            });

            it('should filter out non-weapon items from Xur inventory', async () => {
                const weaponCategoryHash = 1;
                const nonWeaponItem = {
                    ...mockItem,
                    itemCategoryHashes: [2], // Different weapon category
                    displayProperties: { name: 'Non-Weapon Item' }
                };
                const itemHashes = [123456];

                authenticationService.authenticate.mockResolvedValue({ bungie: { access_token: accessToken } });
                destinyService.getProfile.mockResolvedValue([mockCharacter]);
                destinyService.getXur.mockResolvedValue(itemHashes);
                worldRepository.getWeaponCategory.mockResolvedValue(weaponCategoryHash);
                worldRepository.getItemByHash.mockResolvedValue(nonWeaponItem);
                notificationService.sendMessage.mockResolvedValue({ status: 'sent' });

                await sendMethod(mockUser, {
                    claimCheckNumber,
                    notificationType: notificationTypes.Xur,
                });

                expect(notificationService.sendMessage).toHaveBeenCalledWith(
                    '', // Empty message since no weapons found
                    phoneNumber,
                    null,
                    { claimCheckNumber, notificationType: notificationTypes.Xur }
                );
            });

            it('should not send any message when no characters found', async () => {
                authenticationService.authenticate.mockResolvedValue({ bungie: { access_token: accessToken } });
                destinyService.getProfile.mockResolvedValue([]); // No characters

                await sendMethod(mockUser, {
                    claimCheckNumber,
                    notificationType: notificationTypes.Xur,
                });

                // No message sent when no characters are found
                expect(notificationService.sendMessage).not.toHaveBeenCalled();
                expect(ClaimCheck.updatePhoneNumber).not.toHaveBeenCalled();
            });

            it('should not send any message when characters is null', async () => {
                authenticationService.authenticate.mockResolvedValue({ bungie: { access_token: accessToken } });
                destinyService.getProfile.mockResolvedValue(null); // Null characters

                await sendMethod(mockUser, {
                    claimCheckNumber,
                    notificationType: notificationTypes.Xur,
                });

                // No message sent when characters is null
                expect(notificationService.sendMessage).not.toHaveBeenCalled();
                expect(ClaimCheck.updatePhoneNumber).not.toHaveBeenCalled();
            });
        });

        describe('when getXur fails with a business-logic error', () => {
            it('should send fallback message for DestinyError from getXur', async () => {
                const xurError = new DestinyError('DestinyVendorNotFound', 'DestinyVendorNotFound', 1627);
                isTransientError.mockReturnValue(false);

                authenticationService.authenticate.mockResolvedValue({ bungie: { access_token: accessToken } });
                destinyService.getProfile.mockResolvedValue([mockCharacter]);
                destinyService.getXur.mockRejectedValue(xurError);
                notificationService.sendMessage.mockResolvedValue({ status: 'sent' });
                ClaimCheck.updatePhoneNumber.mockResolvedValue();

                await sendMethod(mockUser, {
                    claimCheckNumber,
                    notificationType: notificationTypes.Xur,
                });

                expect(notificationService.sendMessage).toHaveBeenCalledWith(
                    'Xur has closed shop. He\'ll return Friday.',
                    phoneNumber,
                    null,
                    { claimCheckNumber, notificationType: notificationTypes.Xur }
                );
                expect(log.info).toHaveBeenCalledWith(JSON.stringify('sent'));
                expect(ClaimCheck.updatePhoneNumber).toHaveBeenCalledWith(
                    claimCheckNumber,
                    phoneNumber,
                    'sent'
                );
            });

            it('should throw UnrecoverableError for non-DestinyError non-transient getXur error', async () => {
                const genericError = new Error('Unexpected failure');
                isTransientError.mockReturnValue(false);

                authenticationService.authenticate.mockResolvedValue({ bungie: { access_token: accessToken } });
                destinyService.getProfile.mockResolvedValue([mockCharacter]);
                destinyService.getXur.mockRejectedValue(genericError);

                const rejection = await sendMethod(mockUser, {
                    claimCheckNumber,
                    notificationType: notificationTypes.Xur,
                }).catch(err => err);

                expect(rejection.name).toBe('UnrecoverableError');
                expect(rejection.message).toBe('Unexpected failure');
                expect(notificationService.sendMessage).not.toHaveBeenCalled();
            });
        });

        describe('when a transient error occurs', () => {
            it('should re-throw transient getXur error for BullMQ retry', async () => {
                const transientError = new Error('Service Unavailable');
                transientError.status = 503;
                isTransientError.mockReturnValue(true);

                authenticationService.authenticate.mockResolvedValue({ bungie: { access_token: accessToken } });
                destinyService.getProfile.mockResolvedValue([mockCharacter]);
                destinyService.getXur.mockRejectedValue(transientError);

                await expect(sendMethod(mockUser, {
                    claimCheckNumber,
                    notificationType: notificationTypes.Xur,
                })).rejects.toThrow('Service Unavailable');

                expect(notificationService.sendMessage).not.toHaveBeenCalled();
            });

            it('should re-throw transient authentication error for BullMQ retry', async () => {
                const transientError = new Error('Gateway Timeout');
                transientError.status = 504;
                isTransientError.mockReturnValue(true);

                authenticationService.authenticate.mockRejectedValue(transientError);

                await expect(sendMethod(mockUser, {
                    claimCheckNumber,
                    notificationType: notificationTypes.Xur,
                })).rejects.toThrow('Gateway Timeout');

                expect(notificationService.sendMessage).not.toHaveBeenCalled();
            });

            it('should re-throw transient getProfile error for BullMQ retry', async () => {
                const transientError = new Error('Internal Server Error');
                transientError.status = 500;
                isTransientError.mockReturnValue(true);

                authenticationService.authenticate.mockResolvedValue({ bungie: { access_token: accessToken } });
                destinyService.getProfile.mockRejectedValue(transientError);

                await expect(sendMethod(mockUser, {
                    claimCheckNumber,
                    notificationType: notificationTypes.Xur,
                })).rejects.toThrow('Internal Server Error');

                expect(notificationService.sendMessage).not.toHaveBeenCalled();
            });
        });

        describe('when a permanent error occurs', () => {
            it('should throw UnrecoverableError for permanent authentication failure with cause', async () => {
                const permanentError = new Error('Invalid credentials');
                isTransientError.mockReturnValue(false);

                authenticationService.authenticate.mockRejectedValue(permanentError);

                const rejection = await sendMethod(mockUser, {
                    claimCheckNumber,
                    notificationType: notificationTypes.Xur,
                }).catch(err => err);

                expect(rejection.name).toBe('UnrecoverableError');
                expect(rejection.message).toBe('Invalid credentials');
                expect(rejection.cause).toBe(permanentError);
                expect(notificationService.sendMessage).not.toHaveBeenCalled();
            });

            it('should throw UnrecoverableError for permanent getProfile failure with cause', async () => {
                const permanentError = new Error('Account not found');
                isTransientError.mockReturnValue(false);

                authenticationService.authenticate.mockResolvedValue({ bungie: { access_token: accessToken } });
                destinyService.getProfile.mockRejectedValue(permanentError);

                const rejection = await sendMethod(mockUser, {
                    claimCheckNumber,
                    notificationType: notificationTypes.Xur,
                }).catch(err => err);

                expect(rejection.name).toBe('UnrecoverableError');
                expect(rejection.message).toBe('Account not found');
                expect(rejection.cause).toBe(permanentError);
                expect(notificationService.sendMessage).not.toHaveBeenCalled();
            });
        });

        describe('when notification type is not Xur', () => {
            it('should not process non-Xur notifications', async () => {
                await sendMethod(mockUser, {
                    claimCheckNumber,
                    notificationType: notificationTypes.Gunsmith,
                });

                expect(authenticationService.authenticate).not.toHaveBeenCalled();
                expect(destinyService.getProfile).not.toHaveBeenCalled();
                expect(notificationService.sendMessage).not.toHaveBeenCalled();
            });
        });
    });
});
