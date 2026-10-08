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
import ClaimCheck, { DUPLICATE, SKIPPED } from '../helpers/claim-check.js';
import mayDeliver from '../helpers/consent.js';
import log from '../helpers/log.js';
import currentWeeklyReset from '../helpers/weekly-reset.js';
import {
    enqueueBroadcast,
    getBroadcast,
    QUEUE_NAME as BROADCAST_QUEUE,
} from './broadcast.queue.js';

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

        subscriber.listen(this.#send.bind(this));
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
     * Record a claim-check outcome without letting the receipt fail the job.
     *
     * The hash lives in Redis, so these writes reject when Redis does. Letting
     * that propagate would hand the job back to BullMQ *after* Twilio had
     * already accepted the message, and the retry would send it a second time
     * - trading a lost receipt for a duplicate SMS, which is much the worse of
     * the two. The suppression path has the same problem in a quieter form: a
     * failed receipt would retry a job that is only going to suppress again.
     *
     * Ordering and terminal-state semantics for this hash are #717's; this
     * only stops a receipt failure from causing a send.
     * @param {string} claimCheckNumber
     * @param {string} phoneNumber
     * @param {string} status
     * @returns {Promise<void>}
     */
    static async #recordOutcome(claimCheckNumber, phoneNumber, status) {
        try {
            await ClaimCheck.updatePhoneNumber(claimCheckNumber, phoneNumber, status);
        } catch (err) {
            log.warn(
                { err, claimCheckNumber, phoneNumber, status },
                'Unable to record the claim-check outcome.',
            );
        }
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
     * @param {string} phoneNumber
     * @param {string} notificationType
     * @param {string} claimCheckNumber
     * @returns {Promise<boolean>}
     */
    async #worthStarting(phoneNumber, notificationType, claimCheckNumber) {
        if (await this.#stillConsents(phoneNumber, notificationType)) {
            return true;
        }

        await NotificationController.#recordOutcome(claimCheckNumber, phoneNumber, SKIPPED);

        return false;
    }

    /**
     * @param {QueuedUser} user
     * @param {{ claimCheckNumber: string, notificationType: string }} param1
     * @returns {Promise<void>}
     */
    async #send(user, { claimCheckNumber, notificationType }) {
        const { membershipId, membershipType, phoneNumber } = user;

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

                    return;
                }

                const { access_token: accessToken } = authenticatedUser.bungie;
                const characters = await this.destiny.getProfile(membershipId, membershipType);

                if (characters?.length) {
                    let itemHashes;

                    try {
                        itemHashes = await this.destiny.getXur(
                            membershipId,
                            membershipType,
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
                        },
                    );

                    await NotificationController.#recordOutcome(
                        claimCheckNumber,
                        phoneNumber,
                        sent ? sent.status : SKIPPED,
                    );
                }
            } catch (err) {
                if (err instanceof XurUnavailableError) {
                    /**
                     * Reached only after the Bungie calls above have run, so
                     * it needs the same guard as the main path.
                     */
                    const sent = await this.notifications.sendMessage(
                        "Xur has closed shop. He'll return Friday.",
                        phoneNumber,
                        undefined,
                        {
                            claimCheckNumber,
                            notificationType,
                            guard: () => this.#stillConsents(phoneNumber, notificationType),
                        },
                    );

                    log.info(JSON.stringify(sent?.status));
                    await NotificationController.#recordOutcome(
                        claimCheckNumber,
                        phoneNumber,
                        sent ? sent.status : SKIPPED,
                    );

                    return;
                }

                if (err instanceof Error && isTransientError(err)) {
                    throw err;
                }

                if (err instanceof UnrecoverableError) {
                    throw err;
                }

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

                throw unrecoverableError;
            }
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
        /** @param {import('../users/user.service.js').SubscribedUser} user */
        const queueRecipient = async user => {
            const { deduplicated } = await this.publisher.sendNotification(user, {
                notificationType,
                claimCheckNumber,
                deduplicationId: `${notificationType}-${weeklyReset}-${user.phoneNumber}`,
            });

            await claimCheck.addPhoneNumber(user.phoneNumber, deduplicated ? DUPLICATE : undefined);

            return deduplicated;
        };
        /** @type {import('./broadcast.queue.js').BroadcastProgress} */
        let progress = { queued: 0, duplicates: 0, done: false, ...job.data.progress };

        while (!progress.done) {
            const { users, cursor } = await this.users.getSubscribedUsersPage(
                notificationType,
                progress.cursor,
            );
            const results = await Promise.allSettled(
                users.map(user => limit(() => queueRecipient(user))),
            );
            const failures = results.filter(result => result.status === 'rejected');

            if (failures.length) {
                for (const { reason: err } of failures) {
                    log.error({ err, claimCheckNumber }, 'Unable to queue a notification.');
                }

                throw new Error(
                    `${failures.length} of ${users.length} recipients on this page could not be queued.`,
                );
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
            await job.updateData({ ...job.data, progress });
        }

        const { cursor: _cursor, ...totals } = progress;

        return totals;
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

                await this.publisher.sendNotification(user, {
                    notificationType: subscription,
                    claimCheckNumber,
                    deduplicationId: `${claimCheckNumber}-${user.phoneNumber}`,
                });
                await claimCheck.addPhoneNumber(phoneNumber);

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
