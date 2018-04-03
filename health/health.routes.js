const HealthController = require('./health.controller'),
	express = require('express');

/**
 * Destiny Routes
 * @param destinyService
 * @param destiny2Service
 * @param documents
 * @param store
 * @param worldRepository
 * @param world2Repository
 * @returns {*}
 */
const routes = ({ destinyService, destiny2Service, documents, store, worldRepository, world2Repository }) => {
	const healthRouter = express.Router();

	/**
	 * Set up routes and initialize the controller.
	 * @type {HealthController}
	 */
	const healthController = new HealthController({
		destinyService,
		destiny2Service,
		documents,
		store,
		worldRepository,
		world2Repository
	});

	/**
	 * Routes
	 */
	healthRouter.route('/')
		.get((req, res) => healthController.getHealth(req, res));

	return healthRouter;
};

module.exports = routes;
