import { createServiceBusService } from 'azure-sb';
import { ExponentialRetryPolicyFilter } from 'azure-common';

import config from '../helpers/config';
import Publisher from '../helpers/publisher';
import Subscriber from '../helpers/subscriber';
import notificationTypes from './notification.types';
import log from '../helpers/log';

const { serviceBus: { connectionString } } = config;

/**
 * Controller class for Notification routes.
 */
class NotificationController {
    constructor(options = {}) {
        const retryOperations = new ExponentialRetryPolicyFilter();
        const serviceBusService = createServiceBusService(connectionString)
            .withFilter(retryOperations);
        const subscriber = new Subscriber();

        this.authentication = options.authenticationService;
        this.destiny = options.destinyService;
        this.notifications = options.notificationService;
        this.publisher = new Publisher({
            serviceBusService,
        });
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
            const user = this.users.getUserByPhoneNumber(phoneNumber);

            if (user && user.phoneNumber) {
                return this.publisher.sendNotification(user, subscription);
            }
        } else {
            const users = await this.users.getSubscribedUsers(subscription);

            return Promise.all(users.map(user => this.publisher
                .sendNotification(user, subscription)));
        }

        return undefined;
    }
}

export default NotificationController;
