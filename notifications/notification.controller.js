const Ghost = require('../helpers/ghost'),
	Publisher = require('../helpers/publisher'),
	Subscriber = require('../helpers/subscriber'),
	log = require('../helpers/log'),
	notificationHeaders = require('../settings/notificationHeaders.json'),
	notificationTypes = require('../notifications/notification.types');

class NotificationController {
	constructor(options = {}) {
		const subscriber = new Subscriber();

		this.publisher = new Publisher();
		this.authentication = options.authenticationService;
		this.destiny = options.destinyService;
		this.ghost = new Ghost({
			destinyService: options.destinyService
		});
		this.notifications = options.notificationService;
		this.users = options.userService;
		this.world = options.worldRepository;

		subscriber.listen(this._send.bind(this));
	}

	async _send(user, notificationType) {
		const { membershipId, membershipType, phoneNumber } = user;

		try {
			if (notificationType === notificationTypes.Xur) {
				const { bungie: { access_token: accessToken }} = await this.authentication.authenticate(user);
				const characters = await this.destiny.getProfile(membershipId, membershipType);

				if (characters && characters.length) {
					const itemHashes = await this.destiny.getXur(membershipId, membershipType, characters[0].characterId, accessToken);
					const worldDatabasePath = await this.ghost.getWorldDatabasePath();

					await this.world.open(worldDatabasePath);
					const items = await Promise.all(itemHashes.map(itemHash => this.world.getItemByHash(itemHash)));
					await this.world.close();

					const message = items.map(({ displayProperties: { name }}) => name).join('\n');

					await this.notifications.sendMessage(message, phoneNumber);
				}
			}
		} catch (err) {
			log.error(err);
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
				})
				.catch(err => {
					log.error(err);
					res.status(500).json(err);
				});
		} else {
			res.status(404).json('That subscription is not recognized.');
		}
	}
}

module.exports = NotificationController;
