/**
 * Route Definitions
 */
const AuthenticationController = require('./authentication/authentication.controller'),
	AuthenticationService = require('./authentication/authentication.service'),
	Destiny2Cache = require('./destiny2/destiny2.cache'),
	Destiny2Service = require('./destiny2/destiny2.service'),
	DestinyCache = require('./destiny/destiny.cache'),
	DestinyService = require('./destiny/destiny.service'),
	NotificationService = require('./notifications/notification.service'),
	UserCache = require('./users/user.cache'),
	UserService = require('./users/user.service'),
	World = require('./helpers/world'),
	World2 = require('./helpers/world2'),
	documents = require('./helpers/documents'),
	twilio = require('twilio'),
	{ accountSid, authToken } = require('./settings/twilio.' + process.env.NODE_ENV + '.json');

class Routes {
	constructor(store) {
		const routes = require('express').Router();

		/**
		 * Dependencies
		 */
		const destinyCache = new DestinyCache();
		const destinyService = new DestinyService({
			cacheService: destinyCache
		});

		const client = twilio(accountSid, authToken);
		const userCache = new UserCache();
		const userService = new UserService({
			cacheService: userCache,
			client,
			documentService: documents
		});

		const authenticationService = new AuthenticationService({
			cacheService: userCache,
			destinyService,
			userService
		});
		const authenticationController = new AuthenticationController({ authenticationService });

		const world = new World();
		const world2 = new World2();
		const destiny2Cache = new Destiny2Cache();
		const destiny2Service = new Destiny2Service({ cacheService: destiny2Cache });
		const notificationService = new NotificationService({
			client
		});

		/**
		 * Routes
		 */
		const destinyRouter = require('./destiny/destiny.routes')({
			authenticationController,
			destinyService,
			userService,
			worldRepository: world
		});
		routes.use('/destiny', destinyRouter);

		const destiny2Router = require('./destiny2/destiny2.routes')({
			authenticationController,
			destiny2Service,
			userService,
			worldRepository: world2
		});
		routes.use('/destiny2', destiny2Router);

		const healthRouter = require('./health/health.routes')({
			destinyService,
			destiny2Service,
			documents,
			store,
			worldRepository: world,
			world2Repository: world2
		});
		routes.use('/health', healthRouter);

		const notificationRouter = require('./notifications/notification.routes')({
			authenticationService,
			destinyService: destiny2Service,
			notificationService,
			userService
		});
		routes.use('/notifications', notificationRouter);

		const twilioRouter = require('./twilio/twilio.routes')({
			authenticationController,
			authenticationService,
			destinyService: destiny2Service,
			userService
		});
		routes.use('/twilio', twilioRouter);

		const userRouter = require('./users/user.routes')({
			authenticationController,
			destiny2Service: destinyService,
			notificationService,
			userService,
			worldRepository: world2
		});
		routes.use('/users', userRouter);

		/**
		 * Validate the existence and the freshness of the Bungie database.
		 */
		routes.validateManifest = () => {
			destinyRouter.validateManifest();
			destiny2Router.validateManifest();
		};

		return routes;
	}
}

module.exports = Routes;
