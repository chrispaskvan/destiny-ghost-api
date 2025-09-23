import {
    beforeEach, describe, expect, it, vi,
} from 'vitest';
import Chance from 'chance';
import publisher from '../helpers/publisher';
import subscriber from '../helpers/subscriber';
import NotificationController from './notification.controller';
import NotificationError from './notification.error';
import notificationTypes from './notification.types';
import ClaimCheck from '../helpers/claim-check';
import log from '../helpers/log';
import throttle from '../helpers/throttle';

vi.mock('../helpers/publisher');
vi.mock('../helpers/subscriber');
vi.mock('./notification.error');
vi.mock('../helpers/claim-check');
vi.mock('../helpers/log', () => ({
    default: {
        info: vi.fn(),
        error: vi.fn(),
    },
}));
vi.mock('../helpers/throttle');

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
    ClaimCheck.mockImplementation(() => mockClaimCheck);
    ClaimCheck.getClaimCheck = vi.fn();
    ClaimCheck.updatePhoneNumber = vi.fn();
    
    // Setup subscriber mock
    subscriber.listen = vi.fn();
    
    // Setup throttle mock
    throttle.mockImplementation(promises => Promise.all(promises));
    
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

            it('should send fallback message when authentication fails', async () => {
                authenticationService.authenticate.mockRejectedValue(new Error('Auth failed'));
                notificationService.sendMessage.mockResolvedValue({ status: 'sent' });

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
            });

            it('should send fallback message when getProfile fails', async () => {
                authenticationService.authenticate.mockResolvedValue({ bungie: { access_token: accessToken } });
                destinyService.getProfile.mockRejectedValue(new Error('Profile failed'));
                notificationService.sendMessage.mockResolvedValue({ status: 'sent' });

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

            it('should send fallback message when getXur fails', async () => {
                authenticationService.authenticate.mockResolvedValue({ bungie: { access_token: accessToken } });
                destinyService.getProfile.mockResolvedValue([mockCharacter]);
                destinyService.getXur.mockRejectedValue(new Error('Xur failed'));
                notificationService.sendMessage.mockResolvedValue({ status: 'sent' });

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
