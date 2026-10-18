import { beforeEach, describe, expect, it, vi } from 'vitest';
import Chance from 'chance';
import { UnrecoverableError } from 'bullmq';
import publisher from '../helpers/publisher.js';
import subscriber from '../helpers/subscriber.js';
import NotificationController from './notification.controller.js';
import NotificationError from './notification.error.js';
import notificationTypes from './notification.types.js';
import ClaimCheck, { DUPLICATE, ERROR, SKIPPED } from '../helpers/claim-check.js';
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
const messageSid = `SM${chance.string({ length: 32, alpha: true, numeric: true })}`;
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
    advance: vi.fn(),
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
    isMovingPlatforms: vi.fn(),
};

/**
 * `sendMessage` checks its `guard` inside the rate limiter's slot, so a double
 * that ignores it would let every suppression test pass on a send that the
 * real service would have withheld.
 * @param {{ sid?: string, status?: string }} [response]
 */
const sendMessageHonouringGuard =
    (response = { sid: messageSid, status: 'sent' }) =>
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
    ClaimCheck.advance = vi.fn();

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

            /**
             * A worker can pick the job up and finish it before this request
             * returns. Were the receipt written after the job was queued, the
             * worker's outcome would find no entry to move on, and the late
             * write would then leave it pending for good.
             */
            it('should record the recipient before queueing their job', async () => {
                userService.getUserByPhoneNumber.mockResolvedValue(mockUser);
                publisher.sendNotification.mockResolvedValue({ deduplicated: false });
                mockClaimCheck.addPhoneNumber.mockResolvedValue();

                await notificationController.create(notificationTypes.Xur, { phoneNumber });

                expect(mockClaimCheck.addPhoneNumber.mock.invocationCallOrder[0]).toBeLessThan(
                    publisher.sendNotification.mock.invocationCallOrder[0],
                );
            });

            it('should queue nothing when the recipient cannot be recorded', async () => {
                userService.getUserByPhoneNumber.mockResolvedValue(mockUser);
                mockClaimCheck.addPhoneNumber.mockRejectedValue(new Error('Redis is down'));

                await expect(
                    notificationController.create(notificationTypes.Xur, { phoneNumber }),
                ).rejects.toThrow('Redis is down');
                expect(publisher.sendNotification).not.toHaveBeenCalled();
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
            // Not the last attempt: the retry may yet queue them.
            expect(ClaimCheck.advance).not.toHaveBeenCalled();
        });

        /**
         * With no retry to come, a recipient who could not be queued would
         * otherwise read as pending for a job that will never exist. The one
         * who was queued keeps their entry: their job does exist.
         */
        it('should record recipients it could not queue on the last attempt', async () => {
            const job = { ...jobWith(), attemptsMade: 4, opts: { attempts: 5 } };

            userService.getSubscribedUsersPage.mockResolvedValueOnce({
                users: [mockUser, otherUser],
                cursor: undefined,
            });
            publisher.sendNotification
                .mockResolvedValueOnce({ deduplicated: false })
                .mockRejectedValueOnce(new Error('Redis unavailable'));
            publisher.hasNotification.mockResolvedValueOnce(false);

            await expect(run(job)).rejects.toThrow('1 of 2 recipients');

            expect(publisher.hasNotification).toHaveBeenCalledExactlyOnceWith(
                otherUser,
                claimCheckNumber,
            );
            expect(ClaimCheck.advance).toHaveBeenCalledExactlyOnceWith(
                claimCheckNumber,
                otherUser.phoneNumber,
                { status: ERROR, reason: 'not-queued' },
            );
        });

        /**
         * The add landed and only its reply was lost: the job exists and
         * will report for itself, so nothing is recorded over it.
         */
        it('should leave a recipient whose job exists despite the failed add', async () => {
            const job = { ...jobWith(), attemptsMade: 4, opts: { attempts: 5 } };

            userService.getSubscribedUsersPage.mockResolvedValueOnce({
                users: [mockUser],
                cursor: undefined,
            });
            publisher.sendNotification.mockRejectedValueOnce(new Error('Socket closed'));
            publisher.hasNotification.mockResolvedValueOnce(true);

            await expect(run(job)).rejects.toThrow('1 of 1 recipients');

            expect(ClaimCheck.advance).not.toHaveBeenCalled();
        });

        it('should leave a recipient pending when it cannot tell whether they were queued', async () => {
            const job = { ...jobWith(), attemptsMade: 4, opts: { attempts: 5 } };

            userService.getSubscribedUsersPage.mockResolvedValueOnce({
                users: [mockUser],
                cursor: undefined,
            });
            publisher.sendNotification.mockRejectedValueOnce(new Error('Redis unavailable'));
            publisher.hasNotification.mockRejectedValueOnce(new Error('Redis unavailable'));

            await expect(run(job)).rejects.toThrow('1 of 1 recipients');

            expect(ClaimCheck.advance).not.toHaveBeenCalled();
            expect(log.warn).toHaveBeenCalledWith(
                expect.objectContaining({ claimCheckNumber, phoneNumber }),
                'Unable to tell whether a recipient was queued; leaving them pending.',
            );
        });

        it.each([
            [
                'reading subscribers',
                job => {
                    userService.getSubscribedUsersPage.mockRejectedValueOnce(
                        new Error('Request rate is large. ActivityId: 9f2c, Cosmos internals'),
                    );

                    return job;
                },
                'Subscribers could not be read.',
            ],
            [
                'saving progress',
                job => {
                    userService.getSubscribedUsersPage.mockResolvedValueOnce({
                        users: [mockUser],
                        cursor: undefined,
                    });
                    job.updateData.mockRejectedValueOnce(
                        new Error("READONLY You can't write against a read only replica."),
                    );

                    return job;
                },
                'Progress could not be saved.',
            ],
        ])(
            'should fail with a message fit for the caller, logging the raw error, when %s fails',
            async (_step, arrange, message) => {
                const job = arrange(jobWith());

                await expect(run(job)).rejects.toThrow(new Error(message));
                expect(log.error).toHaveBeenCalledExactlyOnceWith(
                    { err: expect.any(Error), claimCheckNumber },
                    message,
                );
            },
        );

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
            expect(mockClaimCheck.addPhoneNumber).toHaveBeenCalledWith(phoneNumber);
            expect(mockClaimCheck.addPhoneNumber).toHaveBeenCalledWith(otherUser.phoneNumber);
            expect(ClaimCheck.advance).toHaveBeenCalledExactlyOnceWith(
                claimCheckNumber,
                phoneNumber,
                { status: DUPLICATE },
            );
        });

        /**
         * Two documents sharing a number, or a membership id that changed
         * across a resume: the second is deduplicated against this
         * operation's own job, whose outcome - delivered, skipped or failed -
         * is the one the receipt must show.
         */
        it("should not mark a recipient a duplicate of this broadcast's own job", async () => {
            userService.getSubscribedUsersPage.mockResolvedValueOnce({
                users: [mockUser],
                cursor: undefined,
            });
            publisher.sendNotification.mockResolvedValueOnce({
                deduplicated: true,
                ownOperation: true,
            });

            await run(jobWith());

            expect(ClaimCheck.advance).not.toHaveBeenCalled();
        });

        it('should not fail the page when a duplicate cannot be marked', async () => {
            userService.getSubscribedUsersPage.mockResolvedValueOnce({
                users: [mockUser],
                cursor: undefined,
            });
            publisher.sendNotification.mockResolvedValueOnce({
                deduplicated: true,
                ownOperation: false,
            });
            ClaimCheck.advance.mockRejectedValue(new Error('Redis is down'));

            await expect(run(jobWith())).resolves.toEqual({
                queued: 0,
                duplicates: 1,
                done: true,
            });
            expect(log.warn).toHaveBeenCalledWith(
                expect.objectContaining({ phoneNumber, outcome: { status: DUPLICATE } }),
                'Unable to record the claim-check outcome.',
            );
        });

        it('should record each recipient before queueing them, so their worker finds an entry', async () => {
            userService.getSubscribedUsersPage.mockResolvedValueOnce({
                users: [mockUser],
                cursor: undefined,
            });
            publisher.sendNotification.mockResolvedValue({ deduplicated: false });

            await run(jobWith());

            expect(mockClaimCheck.addPhoneNumber.mock.invocationCallOrder[0]).toBeLessThan(
                publisher.sendNotification.mock.invocationCallOrder[0],
            );
        });

        it('should not queue a recipient it could not record', async () => {
            userService.getSubscribedUsersPage.mockResolvedValueOnce({
                users: [mockUser],
                cursor: undefined,
            });
            mockClaimCheck.addPhoneNumber.mockRejectedValue(new Error('Redis is down'));

            await expect(run(jobWith())).rejects.toThrow();
            expect(publisher.sendNotification).not.toHaveBeenCalled();
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
                expect(ClaimCheck.advance).toHaveBeenCalledWith(claimCheckNumber, phoneNumber, {
                    status: SKIPPED,
                    reason: 'opted-out',
                });
            });

            /**
             * Part way through `movePlatform` the number's only document is
             * the marked old copy, so consent finds no live account. That is
             * a move in progress, not an account that has gone: the job must
             * be tried again once the new copy exists, not skipped for good.
             */
            it('should try again later, not skip, while the account is moving platforms', async () => {
                userService.getConsentByPhoneNumber.mockResolvedValue(undefined);
                userService.isMovingPlatforms.mockResolvedValue(true);

                await expect(
                    sendMethod(mockUser, {
                        claimCheckNumber,
                        notificationType: notificationTypes.Xur,
                    }),
                ).rejects.toThrow('moving platforms');

                expect(userService.isMovingPlatforms).toHaveBeenCalledWith(phoneNumber);
                expect(notificationService.sendMessage).not.toHaveBeenCalled();
                expect(ClaimCheck.advance).not.toHaveBeenCalled();
            });

            it('should go ahead if the move lands between the consent read and the move check', async () => {
                userService.getConsentByPhoneNumber
                    .mockResolvedValueOnce(undefined)
                    .mockResolvedValue({ isSubscribed: true });
                userService.isMovingPlatforms.mockResolvedValue(false);
                authenticationService.authenticate.mockResolvedValue(undefined);

                await sendMethod(mockUser, {
                    claimCheckNumber,
                    notificationType: notificationTypes.Xur,
                });

                expect(authenticationService.authenticate).toHaveBeenCalled();
                expect(ClaimCheck.advance).not.toHaveBeenCalledWith(claimCheckNumber, phoneNumber, {
                    status: SKIPPED,
                    reason: 'opted-out',
                });
            });

            /**
             * A job queued from the old copy of a user part way through a
             * move carries the platform they have left. `authenticate` reads
             * the live record by phone number, and that is whose identity
             * goes to Bungie.
             */
            it("should ask Bungie about the live record's identity, not the one the job was queued with", async () => {
                const liveMembershipId = chance.guid();

                authenticationService.authenticate.mockResolvedValue({
                    bungie: { access_token: accessToken },
                    membershipId: liveMembershipId,
                    membershipType: 3,
                });
                destinyService.getProfile.mockResolvedValue([mockCharacter]);
                destinyService.getXur.mockResolvedValue([]);
                worldRepository.getWeaponCategory.mockResolvedValue(1);

                await sendMethod(
                    { ...mockUser, membershipType: 1 },
                    { claimCheckNumber, notificationType: notificationTypes.Xur },
                );

                expect(destinyService.getProfile).toHaveBeenCalledWith(liveMembershipId, 3);
                expect(destinyService.getXur).toHaveBeenCalledWith(
                    liveMembershipId,
                    3,
                    characterId,
                    accessToken,
                );
            });

            it('should skip a number with no account at all, as before', async () => {
                userService.getConsentByPhoneNumber.mockResolvedValue(undefined);
                userService.isMovingPlatforms.mockResolvedValue(false);

                await sendMethod(mockUser, {
                    claimCheckNumber,
                    notificationType: notificationTypes.Xur,
                });

                expect(ClaimCheck.advance).toHaveBeenCalledWith(claimCheckNumber, phoneNumber, {
                    status: SKIPPED,
                    reason: 'opted-out',
                });
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
                expect(ClaimCheck.advance).toHaveBeenCalledWith(claimCheckNumber, phoneNumber, {
                    status: SKIPPED,
                    reason: 'opted-out',
                });
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
                expect(ClaimCheck.advance).toHaveBeenCalledWith(claimCheckNumber, phoneNumber, {
                    status: SKIPPED,
                    reason: 'opted-out',
                });
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
                expect(ClaimCheck.advance).toHaveBeenCalledWith(claimCheckNumber, phoneNumber, {
                    status: SKIPPED,
                    reason: 'opted-out',
                });
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
                expect(ClaimCheck.advance).toHaveBeenCalledWith(claimCheckNumber, phoneNumber, {
                    status: SKIPPED,
                    reason: 'opted-out',
                });
            });
        });

        describe('when the claim check cannot be written', () => {
            it('should not fail a suppressed job, which would retry it', async () => {
                userService.getConsentByPhoneNumber.mockResolvedValue({ isSubscribed: false });
                ClaimCheck.advance.mockRejectedValue(new Error('Redis is down'));

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
                ClaimCheck.advance.mockRejectedValue(new Error('Redis is down'));

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
                ClaimCheck.advance.mockRejectedValue(new Error('Redis is down'));

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
                ClaimCheck.advance.mockResolvedValue();

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
                expect(ClaimCheck.advance).toHaveBeenCalledWith(claimCheckNumber, phoneNumber, {
                    status: 'sent',
                    sid: messageSid,
                });
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
                ClaimCheck.advance.mockResolvedValue();

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

            it('should record a skip, sending nothing, when no characters found', async () => {
                authenticationService.authenticate.mockResolvedValue({
                    bungie: { access_token: accessToken },
                });
                destinyService.getProfile.mockResolvedValue([]);

                await sendMethod(mockUser, {
                    claimCheckNumber,
                    notificationType: notificationTypes.Xur,
                });

                expect(notificationService.sendMessage).not.toHaveBeenCalled();
                expect(ClaimCheck.advance).toHaveBeenCalledExactlyOnceWith(
                    claimCheckNumber,
                    phoneNumber,
                    { status: SKIPPED, reason: 'no-characters' },
                );
            });

            it('should record a skip, sending nothing, when characters is null', async () => {
                authenticationService.authenticate.mockResolvedValue({
                    bungie: { access_token: accessToken },
                });
                destinyService.getProfile.mockResolvedValue(null);

                await sendMethod(mockUser, {
                    claimCheckNumber,
                    notificationType: notificationTypes.Xur,
                });

                expect(notificationService.sendMessage).not.toHaveBeenCalled();
                expect(ClaimCheck.advance).toHaveBeenCalledExactlyOnceWith(
                    claimCheckNumber,
                    phoneNumber,
                    { status: SKIPPED, reason: 'no-characters' },
                );
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
                expect(ClaimCheck.advance).toHaveBeenCalledExactlyOnceWith(
                    claimCheckNumber,
                    phoneNumber,
                    { status: SKIPPED, reason: 'unauthenticated' },
                );
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
                expect(ClaimCheck.advance).toHaveBeenCalledExactlyOnceWith(
                    claimCheckNumber,
                    phoneNumber,
                    { status: SKIPPED, reason: 'unauthenticated' },
                );
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
                ClaimCheck.advance.mockResolvedValue();

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
                expect(ClaimCheck.advance).toHaveBeenCalledWith(claimCheckNumber, phoneNumber, {
                    status: 'sent',
                    sid: messageSid,
                });
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

        /**
         * A failure the retry may yet recover from records nothing; BullMQ's
         * decision that there will be no retry is what records the error, so
         * the receipt and the queue cannot disagree about it.
         */
        it('should record nothing itself when a send fails', async () => {
            isTransientError.mockReturnValue(true);
            authenticationService.authenticate.mockRejectedValue(new Error('Service Unavailable'));

            await expect(
                sendMethod(mockUser, {
                    claimCheckNumber,
                    notificationType: notificationTypes.Xur,
                }),
            ).rejects.toThrow('Service Unavailable');

            expect(ClaimCheck.advance).not.toHaveBeenCalled();
        });

        describe('when notification type is not Xur', () => {
            it('should not process non-Xur notifications, recording why', async () => {
                await sendMethod(mockUser, {
                    claimCheckNumber,
                    notificationType: notificationTypes.Gunsmith,
                });

                expect(authenticationService.authenticate).not.toHaveBeenCalled();
                expect(destinyService.getProfile).not.toHaveBeenCalled();
                expect(notificationService.sendMessage).not.toHaveBeenCalled();
                expect(ClaimCheck.advance).toHaveBeenCalledExactlyOnceWith(
                    claimCheckNumber,
                    phoneNumber,
                    { status: SKIPPED, reason: 'unsupported-type' },
                );
            });
        });
    });

    describe('when BullMQ gives up on a send', () => {
        let gaveUp;

        beforeEach(() => {
            gaveUp = subscriber.listen.mock.calls[0][2].onGiveUp;
        });

        it('should record retries exhausted for a job that used every attempt', async () => {
            await gaveUp(
                mockUser,
                { claimCheckNumber, notificationType: notificationTypes.Xur },
                { attemptsMade: 3, opts: { attempts: 3 } },
                new Error('Service Unavailable'),
            );

            expect(ClaimCheck.advance).toHaveBeenCalledExactlyOnceWith(
                claimCheckNumber,
                phoneNumber,
                { status: ERROR, reason: 'retries-exhausted' },
            );
        });

        it('should record a permanent failure for one refused its remaining attempts', async () => {
            await gaveUp(
                mockUser,
                { claimCheckNumber, notificationType: notificationTypes.Xur },
                { attemptsMade: 1, opts: { attempts: 3 } },
                new UnrecoverableError('Invalid credentials'),
            );

            expect(ClaimCheck.advance).toHaveBeenCalledExactlyOnceWith(
                claimCheckNumber,
                phoneNumber,
                { status: ERROR, reason: 'permanent' },
            );
        });

        /**
         * Two transient failures and then a permanent one: the job has used
         * every attempt, but it stopped because it was refused, not because
         * it ran out.
         */
        it.each([
            ['an UnrecoverableError', () => new UnrecoverableError('Account not found')],
            [
                'one from another copy of BullMQ, by name',
                () =>
                    Object.assign(new Error('job stalled more than allowable limit'), {
                        name: 'UnrecoverableError',
                    }),
            ],
        ])('should record a permanent failure for %s on the last attempt', async (_, err) => {
            await gaveUp(
                mockUser,
                { claimCheckNumber, notificationType: notificationTypes.Xur },
                { attemptsMade: 3, opts: { attempts: 3 } },
                err(),
            );

            expect(ClaimCheck.advance).toHaveBeenCalledExactlyOnceWith(
                claimCheckNumber,
                phoneNumber,
                { status: ERROR, reason: 'permanent' },
            );
        });

        it('should not throw when the receipt cannot be written', async () => {
            ClaimCheck.advance.mockRejectedValue(new Error('Redis is down'));

            await expect(
                gaveUp(
                    mockUser,
                    { claimCheckNumber, notificationType: notificationTypes.Xur },
                    { attemptsMade: 3, opts: { attempts: 3 } },
                    new Error('Service Unavailable'),
                ),
            ).resolves.toBeUndefined();
        });
    });
});
