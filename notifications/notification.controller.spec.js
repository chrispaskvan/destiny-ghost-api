import {
    beforeEach, describe, expect, it, vi,
} from 'vitest';
import Chance from 'chance';
import publisher from '../helpers/publisher';
import NotificationController from './notification.controller';

vi.mock('../helpers/publisher');

const chance = new Chance();
const phoneNumber = chance.phone();
const mockUser = {
    phoneNumber,
};
const authenticationService = {};
const destinyService = {};
const notificationService = {};
const userService = {
    getSubscribedUsers: vi.fn(),
};
const worldRepository = {};

let notificationController;

beforeEach(() => {
    notificationController = new NotificationController({
        authenticationService,
        destinyService,
        notificationService,
        publisher,
        userService,
        worldRepository,
    });
});

describe('NotificationController', () => {
    describe('create', () => {
        describe('when phone number is not given', () => {
            it('should send notifications to all subscribed users', async () => {
                const numberOfSubscribedUsers = 11;

                publisher.sendNotification.mockImplementation(() => Promise.resolve());
                userService.getSubscribedUsers.mockImplementation(() => Promise.resolve(
                    new Array(numberOfSubscribedUsers).fill(mockUser),
                ));

                const results = await notificationController.create('some-subscription');

                expect(results.length).toEqual(numberOfSubscribedUsers);
            });
        });
    });
});
