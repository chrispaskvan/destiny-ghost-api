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
import ClaimCheck, { SKIPPED } from '../helpers/claim-check.js';
import mayDeliver from '../helpers/consent.js';
import log from '../helpers/log.js';

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
 * The queued job payload: the JSON-serialized user this controller
 * published (via helpers/publisher.js) and now receives back (via
 * helpers/subscriber.js) to process a notification for.
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
     * Send notification(s)
     *
     * @param {string} subscription
     * @param {string} [phoneNumber]
     */
    async create(subscription, phoneNumber) {
        const claimCheck = new ClaimCheck();
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
                });
                await claimCheck.addPhoneNumber(phoneNumber);

                return claimCheckNumber;
            }

            throw new NotificationError('user not found');
        }

        const users = await this.users.getSubscribedUsers(subscription);
        const limit = pLimit(20);
        /** @param {import('../users/user.service.js').SubscribedUser} user */
        const sendNotification = async user => {
            await this.publisher.sendNotification(user, {
                notificationType: subscription,
                claimCheckNumber,
            });
            await claimCheck.addPhoneNumber(user.phoneNumber);
        };

        Promise.all(users.map(user => limit(() => sendNotification(user)))).catch(err =>
            log.error(err),
        );

        return claimCheckNumber;
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
