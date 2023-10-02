import publisher from '../helpers/publisher';
import subscriber from '../helpers/subscriber';
import NotificationError from './notification.error';
import notificationTypes from './notification.types';
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
    async #send(user, notificationType) {
        try {
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
                        const items = await Promise.all(itemHashes
                            .map(itemHash => this.world.getItemByHash(itemHash)));
                        const message = items.map(({ displayProperties: { name } }) => name).join('\n');
                        await this.notifications.sendMessage(message, phoneNumber);
                    }
                } catch (err) {
                    await this.notifications.sendMessage('Xur has closed shop. He\'ll return Friday.', phoneNumber);
                }
            }
        } catch (err) {
            log.error(err);
        }
    }

    /**
     * Send notification(s)
     *
     * @param {*} subscription
     * @param {*} phoneNumber
     */
    async create(subscription, phoneNumber) {
        if (phoneNumber) {
            const user = await this.users.getUserByPhoneNumber(phoneNumber);

            if (user && user.phoneNumber) {
                return await this.publisher.sendNotification(user, subscription);
            }

            throw new NotificationError('user not found');
        } else {
            const users = await this.users.getSubscribedUsers(subscription);

            return throttle(users.map(user => this.publisher
                .sendNotification(user, subscription)), 2, 500);
        }
    }
}

export default NotificationController;
