import { beforeEach, describe, expect, it, vi } from 'vitest';
import Chance from 'chance';
import publisher from '../helpers/publisher.js';
import subscriber from '../helpers/subscriber.js';
import NotificationController from './notification.controller.js';
import NotificationError from './notification.error.js';
import notificationTypes from './notification.types.js';
import ClaimCheck, { DUPLICATE, SKIPPED } from '../helpers/claim-check.js';
import log from '../helpers/log.js';
import { enqueueBroadcast } from './broadcast.queue.js';

vi.mock('bullmq', () => ({
    // Matches real BullMQ's constructor, which only accepts a message - a
    // second argument (e.g. `{ cause }`) is silently dropped, unlike native
    // `Error`. Forwarding it here would let notification.controller.js's own
    // `unrecoverableError.cause = err` assignment go untested.
    UnrecoverableError: class UnrecoverableError extends Error {
        constructor(message) {
            super(message);
            this.name = 'UnrecoverableError';
        }
    },
    Queue: class {
        add = vi.fn().mockResolvedValue('some-job');
        getJob = vi.fn();
    },
    QueueEvents: class {
        on = vi.fn();
    },
}));

vi.mock('../helpers/publisher.js');
vi.mock('../helpers/subscriber.js');
vi.mock('./notification.error.js');
vi.mock('../helpers/claim-check.js');
vi.mock('./broadcast.queue.js', () => ({ enqueueBroadcast: vi.fn(), QUEUE_NAME: 'broadcasts' }));
vi.mock('../helpers/log.js', () => ({
    default: {
        info: vi.fn(),
        error: vi.fn(),
        warn: vi.fn(),
    },
}));
vi.mock('../helpers/retry.js', async importOriginal => {
    const original = await importOriginal();
    return {
        ...original,
        isTransientError: vi.fn(),
    };
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
    bungie: { access_token: accessToken },
};
const mockCharacter = {
    characterId,
};
const mockItem = {
    hash: 123456,
    displayProperties: { name: 'Test Weapon' },
    itemCategoryHashes: [1], // Weapon category
};
const mockClaimCheck = {
    number: claimCheckNumber,
    addPhoneNumber: vi.fn(),
    updatePhoneNumber: vi.fn(),
};
const authenticationService = {
    authenticate: vi.fn(),
};
const destinyService = {
    getProfile: vi.fn(),
    getXur: vi.fn(),
};
const notificationService = {
    sendMessage: vi.fn(),
};
const userService = {
    getSubscribedUsers: vi.fn(),
    getSubscribedUsersPage: vi.fn(),
    getUserByPhoneNumber: vi.fn(),
    getConsentByPhoneNumber: vi.fn(),
};

/**
 * `sendMessage` checks its `guard` inside the rate limiter's slot, so a double
 * that ignores it would let every suppression test pass on a send that the
 * real service would have withheld.
 * @param {{ status?: string }} [response]
 */
const sendMessageHonouringGuard =
    (response = { status: 'sent' }) =>
    async (_body, _to, _mediaUrl, { guard } = {}) =>
        guard && !(await guard()) ? undefined : response;
const worldRepository = {
    getWeaponCategory: vi.fn(),
    getItemByHash: vi.fn(),
};

let notificationController;

beforeEach(() => {
    vi.clearAllMocks();

    // Setup ClaimCheck mock
    // biome-ignore lint/complexity/useArrowFunction: function expression required — `new` ignores return value of arrow functions
    ClaimCheck.mockImplementation(function () {
        return mockClaimCheck;
    });
    ClaimCheck.getClaimCheck = vi.fn();
    ClaimCheck.updatePhoneNumber = vi.fn();

    // Setup subscriber mock
    subscriber.listen = vi.fn();

    // Default: errors are not transient
    isTransientError.mockReturnValue(false);
    // Default: consent still permits delivery. The gate runs before the job
    // starts and again inside the limiter slot, so without this each test
    // would exercise suppression.
    userService.getConsentByPhoneNumber.mockResolvedValue({ isSubscribed: true });
    notificationService.sendMessage.mockImplementation(sendMessageHonouringGuard());
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
                publisher.sendNotification.mockResolvedValue({ deduplicated: false });
                mockClaimCheck.addPhoneNumber.mockResolvedValue();

                const result = await notificationController.create(subscription, { phoneNumber });

                expect(userService.getUserByPhoneNumber).toHaveBeenCalledWith(phoneNumber);
                expect(publisher.sendNotification).toHaveBeenCalledWith(mockUser, {
                    notificationType: subscription,
                    claimCheckNumber,
                    deduplicationId: `${claimCheckNumber}-${phoneNumber}`,
                });
                expect(mockClaimCheck.addPhoneNumber).toHaveBeenCalledWith(phoneNumber);
                expect(result).toEqual({ claimCheckNumber });
            });

            it('should throw NotificationError when user is not found', async () => {
                const subscription = notificationTypes.Xur;

                userService.getUserByPhoneNumber.mockResolvedValue(null);

                await expect(
                    notificationController.create(subscription, { phoneNumber }),
                ).rejects.toThrow(NotificationError);

                expect(NotificationError).toHaveBeenCalledWith('user not found');
            });

            it('should throw NotificationError when user has no phone number', async () => {
                const subscription = notificationTypes.Xur;
                const userWithoutPhone = { ...mockUser, phoneNumber: null };

                userService.getUserByPhoneNumber.mockResolvedValue(userWithoutPhone);

                await expect(
                    notificationController.create(subscription, { phoneNumber }),
                ).rejects.toThrow(NotificationError);
            });

            it('should throw NotificationError when user has opted out', async () => {
                const subscription = notificationTypes.Xur;
                const optedOutUser = { ...mockUser, isSubscribed: false };

                userService.getUserByPhoneNumber.mockResolvedValue(optedOutUser);

                await expect(
                    notificationController.create(subscription, { phoneNumber }),
                ).rejects.toThrow(NotificationError);

                expect(NotificationError).toHaveBeenCalledWith(
                    'user has opted out of notifications',
                );
                expect(publisher.sendNotification).not.toHaveBeenCalled();
            });
        });

        describe('when phone number is not provided', () => {
            it('should record the broadcast durably for the worker, in the week it was accepted', async () => {
                vi.spyOn(Temporal.Now, 'zonedDateTimeISO').mockReturnValueOnce(
                    Temporal.ZonedDateTime.from('2026-10-09T17:00:00[UTC]'),
                );
                enqueueBroadcast.mockResolvedValue({ id: claimCheckNumber });

                const result = await notificationController.create(notificationTypes.Xur, {
                    operationId: claimCheckNumber,
                });

                expect(ClaimCheck).toHaveBeenCalledWith(claimCheckNumber);
                expect(enqueueBroadcast).toHaveBeenCalledExactlyOnceWith({
                    operationId: claimCheckNumber,
                    notificationType: notificationTypes.Xur,
                    weeklyReset: '2026-10-06',
                });
                expect(userService.getSubscribedUsersPage).not.toHaveBeenCalled();
                expect(publisher.sendNotification).not.toHaveBeenCalled();
                expect(result).toEqual({ claimCheckNumber });
            });

            it('should refuse a type there are no subscriptions for, without recording it', async () => {
                await expect(notificationController.create('not-a-type')).rejects.toThrow(
                    'notificationType is not valid',
                );
                expect(enqueueBroadcast).not.toHaveBeenCalled();
            });

            it('should not acknowledge a broadcast that could not be recorded', async () => {
                const err = new Error('Redis unavailable');

                enqueueBroadcast.mockRejectedValue(err);

                await expect(notificationController.create(notificationTypes.Xur)).rejects.toBe(
                    err,
                );
            });
        });
    });

    describe('broadcast worker', () => {
        const otherUser = { ...mockUser, membershipId: chance.guid(), phoneNumber: chance.phone() };
        let broadcast;

        /**
         * A job as BullMQ hands it over: the envelope `enqueueBroadcast`
         * writes, with whatever progress an earlier attempt saved, and an
         * `updateData` that saves the way Redis would.
         */
        const jobWith = progress => {
            const job = {
                data: {
                    body: JSON.stringify({ weeklyReset: '2026-09-29' }),
                    applicationProperties: {
                        claimCheckNumber,
                        notificationType: notificationTypes.Xur,
                    },
                    ...(progress && { progress }),
                },
                updateData: vi.fn(async data => {
                    job.data = data;
                }),
            };

            return job;
        };
        const run = job =>
            broadcast(JSON.parse(job.data.body), job.data.applicationProperties, job);

        beforeEach(() => {
            [broadcast] = subscriber.listen.mock.calls.find(([, queue]) => queue === 'broadcasts');
            publisher.sendNotification.mockResolvedValue({ deduplicated: false });
            mockClaimCheck.addPhoneNumber.mockResolvedValue();
        });

        it('should listen one broadcast at a time, surviving more than one crash', () => {
            expect(subscriber.listen).toHaveBeenCalledWith(expect.any(Function), 'broadcasts', {
                concurrency: 1,
                maxStalledCount: 5,
            });
        });

        it('should queue every page, saving progress after each, until there are no more', async () => {
            const job = jobWith();

            userService.getSubscribedUsersPage
                .mockResolvedValueOnce({ users: [mockUser], cursor: 'page-2' })
                .mockResolvedValueOnce({ users: [otherUser], cursor: undefined });

            await expect(run(job)).resolves.toEqual({ queued: 2, duplicates: 0, done: true });

            expect(userService.getSubscribedUsersPage.mock.calls).toEqual([
                [notificationTypes.Xur, undefined],
                [notificationTypes.Xur, 'page-2'],
            ]);
            expect(job.updateData.mock.calls.map(([data]) => data.progress)).toEqual([
                { cursor: 'page-2', queued: 1, duplicates: 0, done: false },
                { cursor: undefined, queued: 2, duplicates: 0, done: true },
            ]);
            expect(ClaimCheck).toHaveBeenCalledWith(claimCheckNumber);
        });

        it('should deduplicate by the week the broadcast was accepted in, not the current one', async () => {
            userService.getSubscribedUsersPage.mockResolvedValueOnce({
                users: [mockUser],
                cursor: undefined,
            });

            await run(jobWith());

            expect(publisher.sendNotification).toHaveBeenCalledExactlyOnceWith(mockUser, {
                notificationType: notificationTypes.Xur,
                claimCheckNumber,
                deduplicationId: `Xur-2026-09-29-${phoneNumber}`,
            });
        });

        it('should resume from the page an earlier attempt saved', async () => {
            const job = jobWith({ cursor: 'page-3', queued: 200, duplicates: 4, done: false });

            userService.getSubscribedUsersPage.mockResolvedValueOnce({
                users: [mockUser],
                cursor: undefined,
            });

            await expect(run(job)).resolves.toEqual({ queued: 201, duplicates: 4, done: true });
            expect(userService.getSubscribedUsersPage).toHaveBeenCalledExactlyOnceWith(
                notificationTypes.Xur,
                'page-3',
            );
        });

        it('should do nothing more for a broadcast already finished', async () => {
            await run(jobWith({ queued: 3, duplicates: 0, done: true }));

            expect(userService.getSubscribedUsersPage).not.toHaveBeenCalled();
        });

        it('should save a page only once every recipient on it is queued', async () => {
            const queueing = Promise.withResolvers();
            const job = jobWith();

            userService.getSubscribedUsersPage.mockResolvedValueOnce({
                users: [mockUser, otherUser],
                cursor: undefined,
            });
            publisher.sendNotification
                .mockResolvedValueOnce({ deduplicated: false })
                .mockReturnValueOnce(queueing.promise);

            const running = run(job);

            await new Promise(resolve => setImmediate(resolve));
            expect(job.updateData).not.toHaveBeenCalled();

            queueing.resolve({ deduplicated: false });
            await running;

            expect(job.updateData).toHaveBeenCalledOnce();
        });

        it('should fail the page, without saving past it, when a recipient cannot be queued', async () => {
            const job = jobWith();

            userService.getSubscribedUsersPage
                .mockResolvedValueOnce({ users: [mockUser], cursor: 'page-2' })
                .mockResolvedValueOnce({ users: [mockUser, otherUser], cursor: undefined });
            publisher.sendNotification
                .mockResolvedValueOnce({ deduplicated: false })
                .mockResolvedValueOnce({ deduplicated: false })
                .mockRejectedValueOnce(new Error('Redis unavailable'));

            await expect(run(job)).rejects.toThrow('1 of 2 recipients');

            expect(job.updateData).toHaveBeenCalledOnce();
            expect(job.data.progress.cursor).toBe('page-2');
            expect(log.error).toHaveBeenCalledOnce();
        });

        it('should count recipients already queued for this week as duplicates', async () => {
            userService.getSubscribedUsersPage.mockResolvedValueOnce({
                users: [mockUser, otherUser],
                cursor: undefined,
            });
            publisher.sendNotification
                .mockResolvedValueOnce({ deduplicated: true })
                .mockResolvedValueOnce({ deduplicated: false });

            await expect(run(jobWith())).resolves.toEqual({
                queued: 1,
                duplicates: 1,
                done: true,
            });
            expect(mockClaimCheck.addPhoneNumber).toHaveBeenCalledWith(phoneNumber, DUPLICATE);
            expect(mockClaimCheck.addPhoneNumber).toHaveBeenCalledWith(
                otherUser.phoneNumber,
                undefined,
            );
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

        describe('when consent changed between enqueue and execution', () => {
            it('should not send to a user who opted out after the job was queued', async () => {
                userService.getConsentByPhoneNumber.mockResolvedValue({ isSubscribed: false });

                await sendMethod(mockUser, {
                    claimCheckNumber,
                    notificationType: notificationTypes.Xur,
                });

                expect(notificationService.sendMessage).not.toHaveBeenCalled();
                expect(ClaimCheck.updatePhoneNumber).toHaveBeenCalledWith(
                    claimCheckNumber,
                    phoneNumber,
                    SKIPPED,
                );
            });

            it('should not authenticate or call Bungie for a suppressed send', async () => {
                userService.getConsentByPhoneNumber.mockResolvedValue({ isSubscribed: false });

                await sendMethod(mockUser, {
                    claimCheckNumber,
                    notificationType: notificationTypes.Xur,
                });

                expect(authenticationService.authenticate).not.toHaveBeenCalled();
                expect(destinyService.getProfile).not.toHaveBeenCalled();
            });

            it('should read the consent projection rather than the whole user', async () => {
                authenticationService.authenticate.mockResolvedValue({
                    bungie: { access_token: accessToken },
                });
                destinyService.getProfile.mockResolvedValue([]);

                await sendMethod(mockUser, {
                    claimCheckNumber,
                    notificationType: notificationTypes.Xur,
                });

                expect(userService.getConsentByPhoneNumber).toHaveBeenCalledWith(phoneNumber);
                expect(userService.getUserByPhoneNumber).not.toHaveBeenCalled();
            });

            it('should suppress when the user disabled that vendor after queueing', async () => {
                userService.getConsentByPhoneNumber.mockResolvedValue({
                    isSubscribed: true,
                    notifications: [{ type: notificationTypes.Xur, enabled: false }],
                });

                await sendMethod(mockUser, {
                    claimCheckNumber,
                    notificationType: notificationTypes.Xur,
                });

                expect(notificationService.sendMessage).not.toHaveBeenCalled();
                expect(ClaimCheck.updatePhoneNumber).toHaveBeenCalledWith(
                    claimCheckNumber,
                    phoneNumber,
                    SKIPPED,
                );
            });

            it('should still send when a different vendor is the disabled one', async () => {
                const weaponCategoryHash = 1;

                userService.getConsentByPhoneNumber.mockResolvedValue({
                    isSubscribed: true,
                    notifications: [
                        { type: notificationTypes.IronBanner, enabled: false },
                        { type: notificationTypes.Xur, enabled: true },
                    ],
                });
                authenticationService.authenticate.mockResolvedValue({
                    bungie: { access_token: accessToken },
                });
                destinyService.getProfile.mockResolvedValue([mockCharacter]);
                destinyService.getXur.mockResolvedValue([123456]);
                worldRepository.getWeaponCategory.mockResolvedValue(weaponCategoryHash);
                worldRepository.getItemByHash.mockResolvedValue(mockItem);
                notificationService.sendMessage.mockImplementation(sendMessageHonouringGuard());

                await sendMethod(mockUser, {
                    claimCheckNumber,
                    notificationType: notificationTypes.Xur,
                });

                expect(notificationService.sendMessage).toHaveBeenCalled();
            });

            it('should suppress rather than throw when consent storage is unavailable', async () => {
                userService.getConsentByPhoneNumber.mockRejectedValue(new Error('Cosmos is down'));

                await expect(
                    sendMethod(mockUser, {
                        claimCheckNumber,
                        notificationType: notificationTypes.Xur,
                    }),
                ).resolves.toBeUndefined();

                expect(notificationService.sendMessage).not.toHaveBeenCalled();
                expect(ClaimCheck.updatePhoneNumber).toHaveBeenCalledWith(
                    claimCheckNumber,
                    phoneNumber,
                    SKIPPED,
                );
            });
        });

        describe('when consent is withdrawn after the Bungie calls', () => {
            /** Subscribed at the early gate, opted out by the time we send. */
            const optOutOnSecondCheck = () => {
                userService.getConsentByPhoneNumber
                    .mockResolvedValueOnce({ isSubscribed: true })
                    .mockResolvedValue({ isSubscribed: false });
            };

            it('should not send the Xur inventory', async () => {
                const weaponCategoryHash = 1;

                optOutOnSecondCheck();
                authenticationService.authenticate.mockResolvedValue({
                    bungie: { access_token: accessToken },
                });
                destinyService.getProfile.mockResolvedValue([mockCharacter]);
                destinyService.getXur.mockResolvedValue([123456]);
                worldRepository.getWeaponCategory.mockResolvedValue(weaponCategoryHash);
                worldRepository.getItemByHash.mockResolvedValue(mockItem);

                await sendMethod(mockUser, {
                    claimCheckNumber,
                    notificationType: notificationTypes.Xur,
                });

                // The early gate let it through, so the work was done...
                expect(destinyService.getXur).toHaveBeenCalled();
                // ...and the guard handed to sendMessage withheld the send.
                expect(notificationService.sendMessage).toHaveBeenCalledWith(
                    expect.any(String),
                    phoneNumber,
                    undefined,
                    expect.objectContaining({ guard: expect.any(Function) }),
                );
                expect(ClaimCheck.updatePhoneNumber).toHaveBeenCalledWith(
                    claimCheckNumber,
                    phoneNumber,
                    SKIPPED,
                );
            });

            it('should not send the Xur-unavailable fallback', async () => {
                optOutOnSecondCheck();
                authenticationService.authenticate.mockResolvedValue({
                    bungie: { access_token: accessToken },
                });
                destinyService.getProfile.mockResolvedValue([mockCharacter]);
                destinyService.getXur.mockRejectedValue(
                    new DestinyError(1627, 'Xur is not around.', 'DestinyVendorNotFound'),
                );

                await sendMethod(mockUser, {
                    claimCheckNumber,
                    notificationType: notificationTypes.Xur,
                });

                expect(notificationService.sendMessage).toHaveBeenCalledWith(
                    expect.stringContaining('Xur has closed shop'),
                    phoneNumber,
                    undefined,
                    expect.objectContaining({ guard: expect.any(Function) }),
                );
                expect(ClaimCheck.updatePhoneNumber).toHaveBeenCalledWith(
                    claimCheckNumber,
                    phoneNumber,
                    SKIPPED,
                );
            });
        });

        describe('when the claim check cannot be written', () => {
            it('should not fail a suppressed job, which would retry it', async () => {
                userService.getConsentByPhoneNumber.mockResolvedValue({ isSubscribed: false });
                ClaimCheck.updatePhoneNumber.mockRejectedValue(new Error('Redis is down'));

                await expect(
                    sendMethod(mockUser, {
                        claimCheckNumber,
                        notificationType: notificationTypes.Xur,
                    }),
                ).resolves.toBeUndefined();

                expect(notificationService.sendMessage).not.toHaveBeenCalled();
            });

            it('should not fail a delivered job, which would send it twice', async () => {
                const weaponCategoryHash = 1;

                authenticationService.authenticate.mockResolvedValue({
                    bungie: { access_token: accessToken },
                });
                destinyService.getProfile.mockResolvedValue([mockCharacter]);
                destinyService.getXur.mockResolvedValue([123456]);
                worldRepository.getWeaponCategory.mockResolvedValue(weaponCategoryHash);
                worldRepository.getItemByHash.mockResolvedValue(mockItem);
                notificationService.sendMessage.mockImplementation(sendMessageHonouringGuard());
                ClaimCheck.updatePhoneNumber.mockRejectedValue(new Error('Redis is down'));

                await expect(
                    sendMethod(mockUser, {
                        claimCheckNumber,
                        notificationType: notificationTypes.Xur,
                    }),
                ).resolves.toBeUndefined();

                expect(notificationService.sendMessage).toHaveBeenCalledTimes(1);
            });

            it('should not fail the Xur-unavailable fallback either', async () => {
                authenticationService.authenticate.mockResolvedValue({
                    bungie: { access_token: accessToken },
                });
                destinyService.getProfile.mockResolvedValue([mockCharacter]);
                destinyService.getXur.mockRejectedValue(
                    new DestinyError(1627, 'Xur is not around.', 'DestinyVendorNotFound'),
                );
                notificationService.sendMessage.mockImplementation(sendMessageHonouringGuard());
                ClaimCheck.updatePhoneNumber.mockRejectedValue(new Error('Redis is down'));

                await expect(
                    sendMethod(mockUser, {
                        claimCheckNumber,
                        notificationType: notificationTypes.Xur,
                    }),
                ).resolves.toBeUndefined();

                expect(notificationService.sendMessage).toHaveBeenCalledTimes(1);
            });
        });

        describe('when notification type is Xur', () => {
            it('should send Xur inventory notification successfully', async () => {
                const weaponCategoryHash = 1;
                const itemHashes = [123456, 789012];

                authenticationService.authenticate.mockResolvedValue({
                    bungie: { access_token: accessToken },
                });
                destinyService.getProfile.mockResolvedValue([mockCharacter]);
                destinyService.getXur.mockResolvedValue(itemHashes);
                worldRepository.getWeaponCategory.mockResolvedValue(weaponCategoryHash);
                worldRepository.getItemByHash.mockResolvedValue(mockItem);
                notificationService.sendMessage.mockImplementation(sendMessageHonouringGuard());
                ClaimCheck.updatePhoneNumber.mockResolvedValue();

                await sendMethod(mockUser, {
                    claimCheckNumber,
                    notificationType: notificationTypes.Xur,
                });

                expect(authenticationService.authenticate).toHaveBeenCalledWith(mockUser);
                expect(destinyService.getProfile).toHaveBeenCalledWith(
                    membershipId,
                    membershipType,
                );
                expect(destinyService.getXur).toHaveBeenCalledWith(
                    membershipId,
                    membershipType,
                    characterId,
                    accessToken,
                );
                expect(worldRepository.getWeaponCategory).toHaveBeenCalled();
                expect(worldRepository.getItemByHash).toHaveBeenCalledTimes(itemHashes.length);
                expect(notificationService.sendMessage).toHaveBeenCalledWith(
                    'Test Weapon\nTest Weapon',
                    phoneNumber,
                    undefined,
                    {
                        claimCheckNumber,
                        notificationType: notificationTypes.Xur,
                        guard: expect.any(Function),
                    },
                );
                expect(ClaimCheck.updatePhoneNumber).toHaveBeenCalledWith(
                    claimCheckNumber,
                    phoneNumber,
                    'sent',
                );
            });

            it('should filter out non-weapon items from Xur inventory', async () => {
                const weaponCategoryHash = 1;
                const nonWeaponItem = {
                    ...mockItem,
                    itemCategoryHashes: [2], // Different weapon category
                    displayProperties: { name: 'Non-Weapon Item' },
                };
                const itemHashes = [123456];

                authenticationService.authenticate.mockResolvedValue({
                    bungie: { access_token: accessToken },
                });
                destinyService.getProfile.mockResolvedValue([mockCharacter]);
                destinyService.getXur.mockResolvedValue(itemHashes);
                worldRepository.getWeaponCategory.mockResolvedValue(weaponCategoryHash);
                worldRepository.getItemByHash.mockResolvedValue(nonWeaponItem);
                notificationService.sendMessage.mockImplementation(sendMessageHonouringGuard());

                await sendMethod(mockUser, {
                    claimCheckNumber,
                    notificationType: notificationTypes.Xur,
                });

                expect(notificationService.sendMessage).toHaveBeenCalledWith(
                    '', // Empty message since no weapons found
                    phoneNumber,
                    undefined,
                    {
                        claimCheckNumber,
                        notificationType: notificationTypes.Xur,
                        guard: expect.any(Function),
                    },
                );
            });

            it('should filter out item hashes missing from the manifest instead of throwing', async () => {
                const weaponCategoryHash = 1;
                const missingItemHash = 999999;
                const itemHashes = [123456, missingItemHash];

                authenticationService.authenticate.mockResolvedValue({
                    bungie: { access_token: accessToken },
                });
                destinyService.getProfile.mockResolvedValue([mockCharacter]);
                destinyService.getXur.mockResolvedValue(itemHashes);
                worldRepository.getWeaponCategory.mockResolvedValue(weaponCategoryHash);
                worldRepository.getItemByHash.mockImplementation(itemHash =>
                    Promise.resolve(itemHash === missingItemHash ? undefined : mockItem),
                );
                notificationService.sendMessage.mockImplementation(sendMessageHonouringGuard());
                ClaimCheck.updatePhoneNumber.mockResolvedValue();

                await sendMethod(mockUser, {
                    claimCheckNumber,
                    notificationType: notificationTypes.Xur,
                });

                expect(notificationService.sendMessage).toHaveBeenCalledWith(
                    'Test Weapon',
                    phoneNumber,
                    undefined,
                    {
                        claimCheckNumber,
                        notificationType: notificationTypes.Xur,
                        guard: expect.any(Function),
                    },
                );
            });

            it('should not send any message when no characters found', async () => {
                authenticationService.authenticate.mockResolvedValue({
                    bungie: { access_token: accessToken },
                });
                destinyService.getProfile.mockResolvedValue([]);

                await sendMethod(mockUser, {
                    claimCheckNumber,
                    notificationType: notificationTypes.Xur,
                });

                expect(notificationService.sendMessage).not.toHaveBeenCalled();
                expect(ClaimCheck.updatePhoneNumber).not.toHaveBeenCalled();
            });

            it('should not send any message when characters is null', async () => {
                authenticationService.authenticate.mockResolvedValue({
                    bungie: { access_token: accessToken },
                });
                destinyService.getProfile.mockResolvedValue(null);

                await sendMethod(mockUser, {
                    claimCheckNumber,
                    notificationType: notificationTypes.Xur,
                });

                expect(notificationService.sendMessage).not.toHaveBeenCalled();
                expect(ClaimCheck.updatePhoneNumber).not.toHaveBeenCalled();
            });

            it('should skip and log a warning when authentication finds no user', async () => {
                authenticationService.authenticate.mockResolvedValue(undefined);

                await sendMethod(mockUser, {
                    claimCheckNumber,
                    notificationType: notificationTypes.Xur,
                });

                expect(log.warn).toHaveBeenCalledWith(
                    { membershipId, membershipType },
                    'Skipping Xur notification: user could not be authenticated.',
                );
                expect(destinyService.getProfile).not.toHaveBeenCalled();
                expect(notificationService.sendMessage).not.toHaveBeenCalled();
            });

            it('should skip and log a warning when the authenticated user has no Bungie access token', async () => {
                authenticationService.authenticate.mockResolvedValue({ bungie: {} });

                await sendMethod(mockUser, {
                    claimCheckNumber,
                    notificationType: notificationTypes.Xur,
                });

                expect(log.warn).toHaveBeenCalledWith(
                    { membershipId, membershipType },
                    'Skipping Xur notification: user could not be authenticated.',
                );
                expect(destinyService.getProfile).not.toHaveBeenCalled();
                expect(notificationService.sendMessage).not.toHaveBeenCalled();
            });

            it('should send fallback SMS when Xur vendor is unavailable', async () => {
                const xurNotFoundErr = new DestinyError(
                    1627,
                    'Vendor not found',
                    'DestinyVendorNotFound',
                );

                authenticationService.authenticate.mockResolvedValue({
                    bungie: { access_token: accessToken },
                });
                destinyService.getProfile.mockResolvedValue([mockCharacter]);
                destinyService.getXur.mockRejectedValue(xurNotFoundErr);
                notificationService.sendMessage.mockImplementation(sendMessageHonouringGuard());
                ClaimCheck.updatePhoneNumber.mockResolvedValue();

                await sendMethod(mockUser, {
                    claimCheckNumber,
                    notificationType: notificationTypes.Xur,
                });

                expect(notificationService.sendMessage).toHaveBeenCalledWith(
                    "Xur has closed shop. He'll return Friday.",
                    phoneNumber,
                    undefined,
                    {
                        claimCheckNumber,
                        notificationType: notificationTypes.Xur,
                        guard: expect.any(Function),
                    },
                );
                expect(log.info).toHaveBeenCalledWith(JSON.stringify('sent'));
                expect(ClaimCheck.updatePhoneNumber).toHaveBeenCalledWith(
                    claimCheckNumber,
                    phoneNumber,
                    'sent',
                );
            });
        });

        describe('when a transient error occurs', () => {
            it('should re-throw transient getXur error for BullMQ retry', async () => {
                const transientError = new Error('Service Unavailable');
                transientError.status = 503;
                isTransientError.mockReturnValue(true);
                authenticationService.authenticate.mockResolvedValue({
                    bungie: { access_token: accessToken },
                });
                destinyService.getProfile.mockResolvedValue([mockCharacter]);
                destinyService.getXur.mockRejectedValue(transientError);

                await expect(
                    sendMethod(mockUser, {
                        claimCheckNumber,
                        notificationType: notificationTypes.Xur,
                    }),
                ).rejects.toThrow('Service Unavailable');

                expect(notificationService.sendMessage).not.toHaveBeenCalled();
            });

            it('should re-throw transient authentication error for BullMQ retry', async () => {
                const transientError = new Error('Gateway Timeout');
                transientError.status = 504;
                isTransientError.mockReturnValue(true);

                authenticationService.authenticate.mockRejectedValue(transientError);

                await expect(
                    sendMethod(mockUser, {
                        claimCheckNumber,
                        notificationType: notificationTypes.Xur,
                    }),
                ).rejects.toThrow('Gateway Timeout');

                expect(notificationService.sendMessage).not.toHaveBeenCalled();
            });

            it('should re-throw transient getProfile error for BullMQ retry', async () => {
                const transientError = new Error('Internal Server Error');
                transientError.status = 500;
                isTransientError.mockReturnValue(true);

                authenticationService.authenticate.mockResolvedValue({
                    bungie: { access_token: accessToken },
                });
                destinyService.getProfile.mockRejectedValue(transientError);

                await expect(
                    sendMethod(mockUser, {
                        claimCheckNumber,
                        notificationType: notificationTypes.Xur,
                    }),
                ).rejects.toThrow('Internal Server Error');

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

                authenticationService.authenticate.mockResolvedValue({
                    bungie: { access_token: accessToken },
                });
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
