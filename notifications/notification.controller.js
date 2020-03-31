const Publisher = require('../helpers/publisher');
const Subscriber = require('../helpers/subscriber');
const { notificationHeaders } = require('../helpers/config');
const notificationTypes = require('./notification.types');
const log = require('../helpers/log');

/**
 * Controller class for Notification routes.
 */
class NotificationController {
    constructor(options = {}) {
        const subscriber = new Subscriber();

        this.publisher = new Publisher();
        this.authentication = options.authenticationService;
        this.destiny = options.destinyService;
        this.notifications = options.notificationService;
        this.users = options.userService;
        this.world = options.worldRepository;

        subscriber.listen(this.send.bind(this));
    }

    /**
     * @private
     * @param user
     * @param notificationType
     * @returns {Promise<void>}
     * @private
     */
    async send(user, notificationType) {
        try {
            const { membershipId, membershipType, phoneNumber } = user;

            if (notificationType === notificationTypes.Xur) {
                try {
                    const { bungie: { access_token: accessToken } } = await this.authentication.authenticate(user); // eslint-disable-line max-len
                    const characters = await this.destiny.getProfile(membershipId, membershipType);

                    if (characters && characters.length) {
                        const itemHashes = await this.destiny.getXur(membershipId,
                            membershipType, characters[0].characterId, accessToken);
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

    async create(req, res) {
        const { headers, params: { subscription } } = req;
        const headerNames = Object.keys(notificationHeaders);

        for (const headerName of headerNames) { // eslint-disable-line no-restricted-syntax
            if (headers[headerName] !== notificationHeaders[headerName]) {
                res.writeHead(403);
                res.end();

                return;
            }
        }

        if (notificationTypes[subscription]) {
            const users = await this.users.getSubscribedUsers(subscription);

            // eslint-disable-next-line max-len
            await Promise.all(users.map(user => this.publisher.sendNotification(user, subscription)));
            res.status(200).end();

            return;
        }

        res.status(404).json('That subscription is not recognized.');
    }
}

module.exports = NotificationController;
