import publisher from '../helpers/publisher';
import subscriber from '../helpers/subscriber';
import NotificationError from './notification.error';
import notificationTypes from './notification.types';
import ClaimCheck from '../helpers/claim-check';
import log from '../helpers/log';
import throttle from '../helpers/throttle';

/**
 * Controller class for Notification routes.
 */
class NotificationController {
    constructor(options = {}) {
        this.authentication = options.authenticationService;
        this.destiny = options.destinyService;
        this.notifications = options.notificationService;
        this.publisher = publisher;
        this.users = options.userService;
        this.world = options.worldRepository;

        subscriber.listen(this.#send.bind(this));
    }

    /**
     * @param user
     * @param notificationType
     * @returns {Promise<void>}
     * @private
     */
    async #send(user, {
        claimCheckNumber,
        notificationType,
    }) {
        const { membershipId, membershipType, phoneNumber } = user;

        if (notificationType === notificationTypes.Xur) {
            try {
                const { bungie: { access_token: accessToken } } = await this
                    .authentication.authenticate(user);
                const characters = await this.destiny.getProfile(membershipId, membershipType);

                if (characters && characters.length) {
                    const itemHashes = await this.destiny.getXur(
                        membershipId,
                        membershipType,
                        characters[0].characterId,
                        accessToken,
                    );
                    const items = itemHashes.map(itemHash => this.world.getItemByHash(itemHash));
                    const message = items
                        .filter(({ itemCategoryHashes }) => itemCategoryHashes.includes(this.world.weaponCategory))
                        .map(({ displayProperties: { name } }) => name).join('\n');
                    const { status } = await this.notifications.sendMessage(message, phoneNumber, null, {
                        claimCheckNumber,
                        notificationType,
                    });
                    await ClaimCheck.updatePhoneNumber(claimCheckNumber, phoneNumber, status);
                }
            } catch {
                const { status } = await this.notifications.sendMessage('Xur has closed shop. He\'ll return Friday.', phoneNumber, null, {
                    claimCheckNumber,
                    notificationType,
                });
                log.info(JSON.stringify(status));
            }
        }
    }

    /**
     * Send notification(s)
     *
     * @param {*} subscription
     * @param {*} phoneNumber
     */
    async create(subscription, phoneNumber) {
        const claimCheck = new ClaimCheck();
        const claimCheckNumber = claimCheck.number;

        if (phoneNumber) {
            const user = await this.users.getUserByPhoneNumber(phoneNumber);

            if (user && user.phoneNumber) {
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

        throttle(users.map(async user => {
            await this.publisher.sendNotification(user, {
                notificationType: subscription,
                claimCheckNumber,
            });
            await claimCheck.addPhoneNumber(user.phoneNumber);
        }), 2, 500);

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
