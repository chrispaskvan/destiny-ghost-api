// @ts-check
import { UnrecoverableError } from 'bullmq';
import pLimit from 'p-limit';
import publisher from '../helpers/publisher.js';
import { isTransientError } from '../helpers/retry.js';
import subscriber from '../helpers/subscriber.js';
import NotificationError from './notification.error.js';
import notificationTypes from './notification.types.js';
import DestinyError from '../destiny/destiny.error.js';
import XurUnavailableError from './xur-unavailable.error.js';
import SendOutcomeUnknownError from './send-outcome-unknown.error.js';
import ClaimCheck, { DUPLICATE, ERROR, SKIPPED } from '../helpers/claim-check.js';
import DispatchRecord from '../helpers/dispatch-record.js';
import mayDeliver from '../helpers/consent.js';
import { isExhausted, isLastAttempt } from '../helpers/job-attempts.js';
import log from '../helpers/log.js';
import currentWeeklyReset from '../helpers/weekly-reset.js';
import {
    PROGRESS_UNSAVED,
    recipientsNotQueued,
    SUBSCRIBERS_UNREADABLE,
} from './broadcast.failures.js';
import {
    enqueueBroadcast,
    getBroadcast,
    QUEUE_NAME as BROADCAST_QUEUE,
} from './broadcast.queue.js';

/**
 * Whether `err` is one of `type`, or carries its name: matched by name as
 * well, as BullMQ matches its own, so one from another copy of the module is
 * not missed.
 * @param {unknown} err
 * @param {new (...args: any[]) => Error} type
 * @returns {boolean}
 */
const isA = (err, type) =>
    err instanceof type || /** @type {{ name?: unknown }} */ (err)?.name === type.name;

/**
 * Constructor options for NotificationController.
 * @typedef {Object} NotificationControllerOptions
 * @property {import('../authentication/authentication.service.js').default} authenticationService
 * @property {import('../destiny2/destiny2.service.js').default} destinyService
 * @property {import('./notification.service.js').default} notificationService
 * @property {import('../users/user.service.js').default} userService
 * @property {import('../helpers/world2.js').default} worldRepository
 */

/**
 * The queued job payload: the identifiers this controller published (via
 * helpers/publisher.js) and now receives back (via helpers/subscriber.js) to
 * process a notification for. Current state - consent, Bungie tokens - is
 * read here rather than carried, since the queue can be hours behind.
 *
 * A job enqueued before the publisher was narrowed still carries the whole
 * user document. Destructuring these three fields reads such a payload
 * correctly, so nothing needs draining.
 * @typedef {Object} QueuedUser
 * @property {string} membershipId
 * @property {number} membershipType
 * @property {string} phoneNumber
 */

/**
 * Controller class for Notification routes.
 */
class NotificationController {
    /**
     * @param {NotificationControllerOptions} options
     */
    constructor(options) {
        this.authentication = options.authenticationService;
        this.destiny = options.destinyService;
        this.notifications = options.notificationService;
        this.publisher = publisher;
        this.users = options.userService;
        this.world = options.worldRepository;

        subscriber.listen(this.#send.bind(this), undefined, {
            onGiveUp: this.#gaveUp.bind(this),
        });
        /**
         * One broadcast at a time, and one whose worker died is picked up
         * again from its saved page up to five times rather than BullMQ's
         * default of once, so a second crash during the same broadcast does
         * not abandon it.
         */
        subscriber.listen(this.#broadcast.bind(this), BROADCAST_QUEUE, {
            concurrency: 1,
            maxStalledCount: 5,
        });
    }

    /**
     * @param {boolean} permanent - the job failed with an `UnrecoverableError`
     * @param {boolean} unknown - the job failed with a `SendOutcomeUnknownError`
     * @param {import('bullmq').Job} job
     * @returns {'unknown-outcome' | 'permanent' | 'retries-exhausted'}
     */
    static #givenUpBecause(permanent, unknown, job) {
        if (unknown) return 'unknown-outcome';

        return permanent || !isExhausted(job) ? 'permanent' : 'retries-exhausted';
    }

    /**
     * What Twilio said when it accepted a message, or the skip recorded when
     * the final consent check withheld it.
     * @param {{ sid: string, status: string } | undefined} sent
     * @returns {import('../helpers/claim-check.js').ClaimCheckEntry}
     */
    static #sentOutcome(sent) {
        return sent
            ? { status: sent.status, sid: sent.sid }
            : { status: SKIPPED, reason: 'opted-out' };
    }

    /**
     * Whether consent still permits this send. Handed to `sendMessage` as its
     * guard, so it runs inside the rate limiter's slot.
     * @param {string} phoneNumber
     * @param {string} notificationType
     * @returns {Promise<boolean>}
     */
    async #stillConsents(phoneNumber, notificationType) {
        return await mayDeliver({ users: this.users, phoneNumber, notificationType });
    }

    /**
     * The early gate: whether this job is worth starting at all, recording the
     * suppression when it is not.
     *
     * A number whose every document is marked `movedTo` belongs to an account
     * part way through `movePlatform`: the old copy is marked, the new one not
     * yet created. Consent finds no live account there, but that is not the
     * same as there being none, so the job throws instead of recording a
     * skip, and BullMQ tries it again once the move has landed. A move that
     * never lands fails the job when its retries run out - recorded as a
     * failure, not quietly skipped.
     * @param {string} phoneNumber
     * @param {string} notificationType
     * @param {string} claimCheckNumber
     * @returns {Promise<boolean>}
     */
    async #worthStarting(phoneNumber, notificationType, claimCheckNumber) {
        if (await this.#stillConsents(phoneNumber, notificationType)) {
            return true;
        }

        if (await this.users.isMovingPlatforms(phoneNumber)) {
            throw new Error('The account is moving platforms; trying again once the move lands.');
        }

        /**
         * Not moving now, but the move may have landed between the consent
         * read above and that check, leaving a live account the first read
         * could not see. Reading consent again settles it either way.
         */
        if (await this.#stillConsents(phoneNumber, notificationType)) {
            return true;
        }

        await ClaimCheck.advance(claimCheckNumber, phoneNumber, {
            status: SKIPPED,
            reason: 'opted-out',
        });

        return false;
    }

    /**
     * Record an error on the receipt of a recipient whose job BullMQ has
     * failed for good. Every attempt short of that records nothing, since
     * the retry may yet send.
     *
     * The reason is why BullMQ stopped, not how far it got: an
     * `UnrecoverableError` - which is also how BullMQ fails a job for
     * stalling more often than the worker allows - is permanent on whichever
     * attempt it lands, and only a job that failed every attempt otherwise
     * ran out of retries. Matched by name as well, as BullMQ does, so one
     * from another copy of the library is not missed.
     *
     * A job that ends still not knowing whether Twilio took its message
     * (#719) says so, rather than calling it an error the recipient was
     * spared: they may well have the text. It is logged as an error too,
     * since only someone checking Twilio's console can settle it now. That
     * is decided by the record of the send, not only the last error: an
     * attempt that may have reached Twilio can be followed by one that fails
     * for some other reason - Bungie down, or the job stalling again - before
     * it gets as far as looking.
     * @param {QueuedUser} user
     * @param {{ claimCheckNumber: string }} properties
     * @param {import('bullmq').Job} job
     * @param {Error} err - what the last attempt failed with
     * @returns {Promise<void>}
     */
    async #gaveUp({ phoneNumber }, { claimCheckNumber }, job, err) {
        const record = await NotificationController.#recordOfSend(claimCheckNumber, phoneNumber);

        /**
         * Twilio took the message, and only what came after failed - a crash
         * before the receipt was written, then a retry that failed at Bungie
         * or stalled again. The receipt says what happened, not that the job
         * failed.
         */
        if (record?.state === 'accepted') {
            await ClaimCheck.advance(
                claimCheckNumber,
                phoneNumber,
                NotificationController.#sentOutcome({ sid: record.sid, status: 'accepted' }),
            );

            return;
        }

        const permanent = isA(err, UnrecoverableError);
        const unknown = isA(err, SendOutcomeUnknownError) || record?.state === 'attempting';

        if (unknown) {
            log.error(
                { err, claimCheckNumber, phoneNumber, jobId: job.id },
                'Gave up not knowing whether Twilio sent the message.',
            );
        }

        await ClaimCheck.advance(claimCheckNumber, phoneNumber, {
            status: ERROR,
            reason: NotificationController.#givenUpBecause(permanent, unknown, job),
        });
    }

    /**
     * What to fail a send job with, so BullMQ retries what may yet succeed
     * and gives up at once on what cannot: a transient error (ours marked
     * `retryable` among them) or an `UnrecoverableError` as it is, anything
     * else made unrecoverable.
     * @param {unknown} err
     * @returns {Error}
     */
    static #forBullMQ(err) {
        if (err instanceof Error && isTransientError(err)) return err;
        if (isA(err, UnrecoverableError)) return /** @type {Error} */ (err);

        /**
         * Unlike native `Error`, BullMQ's `UnrecoverableError` constructor
         * only accepts a message - a second `{ cause }` argument is
         * silently dropped. Set `cause` as a property afterward so it's
         * not lost.
         */
        const unrecoverableError = new UnrecoverableError(
            err instanceof Error ? err.message : String(err),
        );

        unrecoverableError.cause = err;

        return unrecoverableError;
    }

    /**
     * The record of this recipient's send, for a job BullMQ has given up on.
     * `null` when there is none, or it cannot be read: the last error then
     * decides on its own.
     * @param {string} claimCheckNumber
     * @param {string} phoneNumber
     * @returns {Promise<import('../helpers/dispatch-record.js').DispatchRecord | null>}
     */
    static async #recordOfSend(claimCheckNumber, phoneNumber) {
        try {
            return await DispatchRecord.read(claimCheckNumber, phoneNumber);
        } catch (err) {
            log.warn(
                { err, claimCheckNumber, phoneNumber },
                'Unable to read the record of the send; going by the last error.',
            );

            return null;
        }
    }

    /**
     * @param {QueuedUser} user
     * @param {{ claimCheckNumber: string, notificationType: string }} param1
     * @returns {Promise<void>}
     */
    async #send(user, { claimCheckNumber, notificationType }) {
        const { membershipId, membershipType, phoneNumber } = user;

        /**
         * A retry whose message already went out reports it and stops, before
         * the consent check and the calls to Bungie: a send already made is
         * not taken back by anything that has changed since, and the work it
         * would repeat could fail or skip before `sendMessage` found out.
         * Throws, for BullMQ to retry, when an earlier attempt cannot be
         * settled yet.
         */
        const settled = await this.notifications.settleEarlier(claimCheckNumber, phoneNumber);

        if (settled.earlier) {
            await ClaimCheck.advance(
                claimCheckNumber,
                phoneNumber,
                NotificationController.#sentOutcome(settled.earlier),
            );

            return;
        }

        /**
         * `create` filtered consent when this job was queued, but that was
         * however long ago the queue is behind - long enough for a STOP to
         * have landed in between.
         *
         * This early check is the cheap one: it sits before the branch below
         * so the types that are not implemented yet (#722) inherit it, and
         * before `authenticate` so an opted-out user costs neither a token
         * refresh nor a call to Bungie on their behalf. It is not the
         * authoritative one - several network round trips separate it from the
         * send - so consent is read again immediately before each outbound
         * message. Paying for two reads on a delivered notification is the
         * price of closing a window that is seconds wide on a slow day.
         *
         * Returns rather than throws: this runs under BullMQ, and a throw
         * would hand the job back to be retried against someone who has
         * already asked not to hear from us.
         */
        if (!(await this.#worthStarting(phoneNumber, notificationType, claimCheckNumber))) {
            return;
        }

        if (notificationType === notificationTypes.Xur) {
            try {
                const authenticatedUser = await this.authentication.authenticate(user);

                if (!authenticatedUser?.bungie?.access_token) {
                    log.warn(
                        { membershipId, membershipType },
                        'Skipping Xur notification: user could not be authenticated.',
                    );
                    await ClaimCheck.advance(claimCheckNumber, phoneNumber, {
                        status: SKIPPED,
                        reason: 'unauthenticated',
                    });

                    return;
                }

                const { access_token: accessToken } = authenticatedUser.bungie;
                /**
                 * The identity to ask Bungie about is the live record's, which
                 * `authenticate` reads by phone number, not the one the job
                 * was queued with: a job queued from the old copy of a user
                 * part way through a platform move carries the platform they
                 * have left.
                 */
                const {
                    membershipId: liveMembershipId = membershipId,
                    membershipType: liveMembershipType = membershipType,
                } = authenticatedUser;
                const characters = await this.destiny.getProfile(
                    liveMembershipId,
                    liveMembershipType,
                );

                if (characters?.length) {
                    let itemHashes;

                    try {
                        itemHashes = await this.destiny.getXur(
                            liveMembershipId,
                            liveMembershipType,
                            characters[0].characterId,
                            accessToken,
                        );
                    } catch (xurErr) {
                        if (xurErr instanceof Error && isTransientError(xurErr)) throw xurErr;
                        if (
                            xurErr instanceof DestinyError &&
                            xurErr.status === 'DestinyVendorNotFound'
                        ) {
                            throw new XurUnavailableError(xurErr.code, xurErr.message, {
                                cause: xurErr,
                            });
                        }
                        throw xurErr;
                    }

                    const weaponCategory = await this.world.getWeaponCategory();
                    const items = (
                        await Promise.all(
                            itemHashes.map(
                                /** @param {number} itemHash */
                                itemHash => this.world.getItemByHash(itemHash),
                            ),
                        )
                    ).filter(
                        /** @returns {item is import('../helpers/world2.js').ItemDefinition} */
                        item => Boolean(item),
                    );
                    const message = items
                        .filter(({ itemCategoryHashes = [] }) =>
                            itemCategoryHashes.includes(weaponCategory),
                        )
                        .map(({ displayProperties: { name } = {} }) => name)
                        .join('\n');
                    /**
                     * The authoritative check, handed to `sendMessage` rather
                     * than run here. Everything between the gate at the top of
                     * this method and the provider call is time a STOP can
                     * land in: a token refresh, a profile fetch, Xur's
                     * inventory, the manifest reads - and then the wait for a
                     * rate limiter slot, which on a broadcast is the longest
                     * part of all. Running it inside that slot is the only
                     * placement with nothing left after it.
                     */
                    const sent = await this.notifications.sendMessage(
                        message,
                        phoneNumber,
                        undefined,
                        {
                            claimCheckNumber,
                            notificationType,
                            guard: () => this.#stillConsents(phoneNumber, notificationType),
                            settled,
                        },
                    );

                    await ClaimCheck.advance(
                        claimCheckNumber,
                        phoneNumber,
                        NotificationController.#sentOutcome(sent),
                    );
                } else {
                    await ClaimCheck.advance(claimCheckNumber, phoneNumber, {
                        status: SKIPPED,
                        reason: 'no-characters',
                    });
                }
            } catch (err) {
                if (err instanceof XurUnavailableError) {
                    /**
                     * Reached only after the Bungie calls above have run, so
                     * it needs the same guard as the main path. Sent from
                     * inside this `catch`, so its own failures are classified
                     * here rather than by what follows.
                     */
                    let sent;

                    try {
                        sent = await this.notifications.sendMessage(
                            "Xur has closed shop. He'll return Friday.",
                            phoneNumber,
                            undefined,
                            {
                                claimCheckNumber,
                                notificationType,
                                guard: () => this.#stillConsents(phoneNumber, notificationType),
                                settled,
                            },
                        );
                    } catch (sendErr) {
                        throw NotificationController.#forBullMQ(sendErr);
                    }

                    log.info(JSON.stringify(sent?.status));
                    await ClaimCheck.advance(
                        claimCheckNumber,
                        phoneNumber,
                        NotificationController.#sentOutcome(sent),
                    );

                    return;
                }

                throw NotificationController.#forBullMQ(err);
            }
        } else {
            /**
             * No other type has a sender yet (#722). Recorded rather than
             * left pending, so the receipt says nothing was sent instead of
             * looking like a job still waiting to run.
             */
            await ClaimCheck.advance(claimCheckNumber, phoneNumber, {
                status: SKIPPED,
                reason: 'unsupported-type',
            });
        }
    }

    /**
     * Queue a broadcast's recipients, a page of subscribers at a time,
     * saving how far it has got on the job after every page.
     *
     * Runs as the broadcast queue's worker, so it outlives the request that
     * accepted the broadcast. If the process dies part way, BullMQ hands the
     * job to the next worker, which starts from the last saved page: the page
     * in progress is queued again, and each recipient's job id makes that a
     * no-op for anyone it already reached. A recipient that cannot be queued
     * fails the page before its progress is saved, so BullMQ's retry comes
     * back to the same page rather than skipping past them.
     *
     * Recipients are deduplicated by event - the notification type and the
     * Destiny week the broadcast was accepted in - so a second broadcast for
     * the same week cannot text anyone twice, while next week's is never
     * mistaken for it.
     * @param {{ weeklyReset: string }} body
     * @param {{ claimCheckNumber: string, notificationType: string }} properties
     * @param {import('bullmq').Job} job
     * @returns {Promise<Omit<import('./broadcast.queue.js').BroadcastProgress, 'cursor'>>}
     */
    async #broadcast({ weeklyReset }, { claimCheckNumber, notificationType }, job) {
        const claimCheck = new ClaimCheck(claimCheckNumber);
        const limit = pLimit(20);
        /** @param {{ phoneNumber: string }} user */
        const deduplicationIdFor = ({ phoneNumber }) =>
            `${notificationType}-${weeklyReset}-${phoneNumber}`;
        /**
         * Recorded before it is queued, so the worker that sends it finds an
         * entry to move on. A queueing failure after that leaves the
         * recipient pending, and the page's retry queues them under the same
         * entry. A recipient who cannot be recorded is queued anyway.
         *
         * Marked a duplicate only when another operation holds them. One
         * deduplicated against this operation's own job is already on this
         * receipt, and that job's outcome is the one to report. Neither write
         * fails the page: the receipt never decides who is sent to.
         * @param {import('../users/user.service.js').SubscribedUser} user
         */
        const queueRecipient = async user => {
            await claimCheck.addPhoneNumber(user.phoneNumber);

            const { deduplicated, ownOperation } = await this.publisher.sendNotification(user, {
                notificationType,
                claimCheckNumber,
                deduplicationId: deduplicationIdFor(user),
            });

            if (deduplicated && !ownOperation) {
                await ClaimCheck.advance(claimCheckNumber, user.phoneNumber, {
                    status: DUPLICATE,
                });
            }

            return deduplicated;
        };
        /** @type {import('./broadcast.queue.js').BroadcastProgress} */
        let progress = { queued: 0, duplicates: 0, done: false, ...job.data.progress };

        /**
         * Whatever a step throws becomes the job's `failedReason`, which the
         * progress endpoint shows to callers. Errors there are private by
         * default (`adr-files/client-safe-error-messages.md`), so each step's
         * raw error is logged here and replaced with a message written for
         * the caller.
         * @template T
         * @param {string} message
         * @param {() => Promise<T>} step
         * @returns {Promise<T>}
         */
        const safely = async (message, step) => {
            try {
                return await step();
            } catch (err) {
                log.error({ err, claimCheckNumber }, message);

                throw new Error(message);
            }
        };

        while (!progress.done) {
            const { users, cursor } = await safely(SUBSCRIBERS_UNREADABLE, () =>
                this.users.getSubscribedUsersPage(notificationType, progress.cursor),
            );
            const results = await Promise.allSettled(
                users.map(user => limit(() => queueRecipient(user))),
            );
            const failures = results.filter(result => result.status === 'rejected');

            if (failures.length) {
                for (const { reason: err } of failures) {
                    log.error({ err, claimCheckNumber }, 'Unable to queue a notification.');
                }

                /**
                 * On the last attempt there is no retry to queue them, so
                 * the recipients that could not be queued are told so rather
                 * than left pending for a job that will never exist. Those
                 * that were queued keep their entry: their job does exist.
                 * Throttled like the queueing, since the Redis that failed
                 * it is the one asked.
                 */
                if (isLastAttempt(job)) {
                    const unqueued = users.filter((_, i) => results[i].status === 'rejected');

                    await Promise.all(
                        unqueued.map(user =>
                            limit(() =>
                                this.#markIfNeverQueued(
                                    user.phoneNumber,
                                    claimCheckNumber,
                                    deduplicationIdFor(user),
                                ),
                            ),
                        ),
                    );
                }

                throw new Error(recipientsNotQueued(failures.length, users.length));
            }

            const duplicates = results.filter(
                result => result.status === 'fulfilled' && result.value,
            ).length;

            progress = {
                cursor,
                queued: progress.queued + users.length - duplicates,
                duplicates: progress.duplicates + duplicates,
                done: !cursor,
            };
            const saved = progress;

            await safely(PROGRESS_UNSAVED, () => job.updateData({ ...job.data, progress: saved }));
        }

        const { cursor: _cursor, ...totals } = progress;

        return totals;
    }

    /**
     * Record a recipient as never queued, once nothing more will try - but
     * only if nothing was queued for them, asked of the deduplication id
     * their add would have claimed. A failed add can still have landed, and
     * another document sharing their phone number can have queued them under
     * its own job; either job reports for itself, and an outcome of ours
     * recorded first would hold the receipt at `not-queued` against a skip
     * or failure of its own. Held by another operation, they are a duplicate,
     * as `queueRecipient` would have recorded. A lookup that fails leaves
     * the entry pending rather than guessing.
     * @param {string} phoneNumber
     * @param {string} claimCheckNumber
     * @param {string} deduplicationId
     * @returns {Promise<void>}
     */
    async #markIfNeverQueued(phoneNumber, claimCheckNumber, deduplicationId) {
        let found;

        try {
            found = await this.publisher.findNotification(deduplicationId, claimCheckNumber);
        } catch (err) {
            log.warn(
                { err, claimCheckNumber, phoneNumber },
                'Unable to tell whether a recipient was queued; leaving them pending.',
            );

            return;
        }

        if (found.ownOperation) return;

        await ClaimCheck.advance(
            claimCheckNumber,
            phoneNumber,
            found.queued ? { status: DUPLICATE } : { status: ERROR, reason: 'not-queued' },
        );
    }

    /**
     * Send notification(s)
     *
     * A broadcast is accepted, not sent, here: it is recorded as a job on the
     * broadcast queue, and `#broadcast` queues its recipients from there, so
     * it survives this process. A single-recipient send is queued directly,
     * and deliberately: it is deduplicated only within its own operation, so
     * sending it again sends it again.
     *
     * @param {string} subscription
     * @param {{ operationId?: string, phoneNumber?: string }} [options] -
     * `operationId` when the caller has already reserved one; a new id
     * otherwise
     * @returns {Promise<{ claimCheckNumber: string }>} once the operation is
     * durably recorded
     */
    async create(subscription, { operationId, phoneNumber } = {}) {
        const claimCheck = new ClaimCheck(operationId);
        const claimCheckNumber = claimCheck.number;

        if (phoneNumber) {
            const user = await this.users.getUserByPhoneNumber(phoneNumber);

            if (user?.phoneNumber) {
                if (user.isSubscribed === false) {
                    throw new NotificationError('user has opted out of notifications');
                }

                /**
                 * Recorded before it is queued, so a worker that finishes
                 * before this request returns finds an entry to move on. If
                 * the queueing fails, the entry stays pending under an id the
                 * caller was never given, and expires with it. If recording
                 * fails, the job is queued anyway.
                 */
                await claimCheck.addPhoneNumber(phoneNumber);
                await this.publisher.sendNotification(user, {
                    notificationType: subscription,
                    claimCheckNumber,
                    deduplicationId: `${claimCheckNumber}-${user.phoneNumber}`,
                });

                return { claimCheckNumber };
            }

            throw new NotificationError('user not found');
        }

        if (!Object.values(notificationTypes).includes(subscription)) {
            throw new Error('notificationType is not valid');
        }

        await enqueueBroadcast({
            operationId: claimCheckNumber,
            notificationType: subscription,
            weeklyReset: currentWeeklyReset(),
        });

        return { claimCheckNumber };
    }

    /**
     * How far a broadcast has got.
     *
     * @param {string} number - Claim Check Number
     */
    async getBroadcast(number) {
        return await getBroadcast(number);
    }

    /**
     * Get contents of the claim check.
     *
     * @param {string} number - Claim Check Number
     * @returns
     */
    async getClaimCheck(number) {
        return await ClaimCheck.getClaimCheck(number);
    }
}

export default NotificationController;
