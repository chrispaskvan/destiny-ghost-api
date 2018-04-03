const NotificationController = require('./notification.controller'),
	express = require('express');

/**
 * Notification Routes
 * @param userService
 * @returns {*}
 */
const routes = ({ authenticationService, destinyService, notificationService, userService, worldRepository }) => {
	const notificationRouter = express.Router();

	/**
	 * Set up routes and initialize the controller.
	 * @type {NotificationController}
	 */
	const notificationController = new NotificationController({ authenticationService, destinyService, notificationService, userService, worldRepository });

	/**
	 * Routes
	 */
	notificationRouter.route('/:subscription')
		.post((req, res) => notificationController.create(req, res));

	notificationRouter.route('/:subscription/:phoneNumber')
		.post((req, res) => notificationController.create(req, res));

	return notificationRouter;
};

module.exports = routes;
