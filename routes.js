/**
 * Route Definitions
 */
const AuthenticationController = require('./authentication/authentication.controller'),
	AuthenticationService = require('./authentication/authentication.service'),
	Destiny2Cache = require('./destiny2/destiny2.cache'),
	Destiny2Service = require('./destiny2/destiny2.service'),
	DestinyCache = require('./destiny/destiny.cache'),
	DestinyService = require('./destiny/destiny.service'),
	UserCache = require('./users/user.cache'),
	UserService = require('./users/user.service'),
	World2 = require('./helpers/world2'),
	documents = require('./helpers/documents');

class Routes {
	constructor(client) {
		const routes = require('express').Router();

		/**
		 * Dependencies
		 */
		const destinyCache = new DestinyCache();
		const destinyService = new DestinyService({
			cacheService: destinyCache
		});

		const userCache = new UserCache();
		const userService = new UserService({
			cacheService: userCache,
			documentService: documents
		});

		const authenticationService = new AuthenticationService({
			cacheService: userCache,
			destinyService,
			userService
		});
		const authenticationController = new AuthenticationController(authenticationService);

		const world2 = new World2();

		const destiny2Cache = new Destiny2Cache();
		const destiny2Service = new Destiny2Service({ cacheService: destiny2Cache });

		/**
		 * Routes
		 */
		const destinyRouter = require('./destiny/destiny.routes')(authenticationController, destinyService, userService, world2);
		routes.use('/api/destiny', destinyRouter);

		const destiny2Router = require('./destiny2/destiny2.routes')(authenticationController, destiny2Service, userService, world2);
		routes.use('/api/destiny2', destiny2Router);

		const healthRouter = require('./health/health.routes')(destiny2Service, documents, client, world2);
		routes.use('/api/health', healthRouter);

		const twilioRouter = require('./twilio/twilio.routes')(authenticationController, destiny2Service, userService, world2);
		routes.use('/api/twilio', twilioRouter);

		const userRouter = require('./users/user.routes')(authenticationController, destinyService, userService);
		routes.use('/api/users', userRouter);

		/**
		 * Validate the existence and the freshness of the Bungie database.
		 */
		routes.validateManifest = function() {
			destinyRouter.validateManifest();
			destiny2Router.validateManifest();
		};

		return routes;
	}
}

module.exports = Routes;
