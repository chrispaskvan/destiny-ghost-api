const Publisher = require('../helpers/publisher'),
	Subscriber = require('../helpers/subscriber'),
	notificationHeaders = require('../settings/notificationHeaders.json'),
	notificationTypes = require('../notifications/notification.types');

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

		subscriber.listen(this._send.bind(this));
	}

	async _send(user, notificationType) {
		const { membershipId, membershipType, phoneNumber } = user;

		if (notificationType === notificationTypes.Xur) {
			try {
				const { bungie: { access_token: accessToken }} = await this.authentication.authenticate(user);
				const characters = await this.destiny.getProfile(membershipId, membershipType);

				if (characters && characters.length) {
					const itemHashes = await this.destiny.getXur(membershipId, membershipType, characters[0].characterId, accessToken);
					const items = await Promise.all(itemHashes.map(itemHash => this.world.getItemByHash(itemHash)));

					const message = items.map(({ displayProperties: { name }}) => name).join('\n');
					await this.notifications.sendMessage(message, phoneNumber);
				}
			} catch (err) {
				await this.notifications.sendMessage('Xur has closed shop. He\'ll return Friday.', phoneNumber);
			}
		}
	}

	create(req, res) {
		const { headers, params: { subscription }} = req;

		for (const headerName in notificationHeaders) {
			if (notificationHeaders.hasOwnProperty(headerName)) {
				if (headers[headerName] !== notificationHeaders[headerName]) {
					res.writeHead(403);
					res.end();
					return;
				}
			}
		}

		if (notificationTypes[subscription]) {
			this.users.getSubscribedUsers(subscription)
				.then(users => {
					users.forEach(user => this.publisher.sendNotification(user, subscription));
					res.status(200).end();
				});
		} else {
			res.status(404).json('That subscription is not recognized.');
		}
	}
}

module.exports = NotificationController;
