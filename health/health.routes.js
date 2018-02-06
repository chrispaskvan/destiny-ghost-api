/**
 * Created by chris on 9/25/15.
 */
const HealthController = require('./health.controller'),
	express = require('express');

/**
 * Destiny Routes
 * @param authenticationController
 * @param destiny2Service
 * @param userService
 * @param worldRepository
 * @returns {*}
 */
const routes = function ({ destinyService, documents, store, worldRepository }) {
	const healthRouter = express.Router();

	/**
	 * Set up routes and initialize the controller.
	 * @type {HealthController}
	 */
	const healthController = new HealthController({ destinyService, documents, store, worldRepository });

	/**
	 * Routes
	 */
	healthRouter.route('/')
		.get(function (req, res) {
			healthController.getHealth(req, res);
		});

	return healthRouter;
};

module.exports = routes;
