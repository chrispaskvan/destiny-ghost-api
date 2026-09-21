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
     * @param {QueuedUser} user
     * @param {{ claimCheckNumber: string, notificationType: string }} param1
     * @returns {Promise<void>}
     */
    async #send(user, { claimCheckNumber, notificationType }) {
        const { membershipId, membershipType, phoneNumber } = user;

        /**
         * `create` filtered consent when this job was queued, but that was
         * however long ago the queue is behind - long enough for a STOP to
         * have landed in between. Checked before the branch below rather than
         * inside it so the types that are not implemented yet (#722) inherit
         * the gate, and before `authenticate` so an opted-out user costs
         * neither a token refresh nor a call to Bungie on their behalf.
         *
         * Returns rather than throws: this runs under BullMQ, and a throw
         * would hand the job back to be retried against someone who has
         * already asked not to hear from us.
         */
        if (!(await mayDeliver({ users: this.users, phoneNumber, notificationType }))) {
            await ClaimCheck.updatePhoneNumber(claimCheckNumber, phoneNumber, SKIPPED);

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
                    const { status } = await this.notifications.sendMessage(
                        message,
                        phoneNumber,
                        undefined,
                        {
                            claimCheckNumber,
                            notificationType,
                        },
                    );

                    await ClaimCheck.updatePhoneNumber(claimCheckNumber, phoneNumber, status);
                }
            } catch (err) {
                if (err instanceof XurUnavailableError) {
                    const { status } = await this.notifications.sendMessage(
                        "Xur has closed shop. He'll return Friday.",
                        phoneNumber,
                        undefined,
                        {
                            claimCheckNumber,
                            notificationType,
                        },
                    );

                    log.info(JSON.stringify(status));
                    await ClaimCheck.updatePhoneNumber(claimCheckNumber, phoneNumber, status);

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
