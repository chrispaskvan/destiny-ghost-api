const express = require('express');
const NotificationController = require('./notification.controller');

/**
 * Notification Routes
 *
 * @param authenticationService
 * @param destinyService
 * @param notificationService
 * @param userService
 * @param worldRepository
 * @returns {*}
 */
const routes = ({
    authenticationService,
    destinyService,
    notificationService,
    userService,
    worldRepository,
}) => {
    const notificationRouter = express.Router();

    /**
     * Set up routes and initialize the controller.
     * @type {NotificationController}
     */
    const notificationController = new NotificationController({
        authenticationService,
        destinyService,
        notificationService,
        userService,
        worldRepository,
    });

    notificationRouter.route('/:subscription')
        .post((req, res, next) => notificationController.create(req, res)
            .catch(next));

    notificationRouter.route('/:subscription/:phoneNumber')
        .post((req, res, next) => notificationController.create(req, res)
            .catch(next));

    return notificationRouter;
};

module.exports = routes;
