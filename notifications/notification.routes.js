const express = require('express');
const notificationTypes = require('./notification.types');
const NotificationController = require('./notification.controller');
const authorizeUser = require('../authorization/authorization.middleware');

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
        .post((req, res, next) => authorizeUser(req, res, next), (req, res, next) => {
            const { params: { subscription } } = req;

            notificationController.create(subscription)
                .then(() => res.status(200).end())
                .catch(next);
        });

    notificationRouter.route('/:subscription/:phoneNumber')
        .post((req, res, next) => authorizeUser(req, res, next), (req, res, next) => {
            const { params: { subscription, phoneNumber } } = req;

            if (!Object.keys(notificationTypes).find(key => key === subscription)) {
                res.status(404).json('That subscription is not recognized.');

                return;
            }

            notificationController.create(subscription, phoneNumber)
                .then(() => res.status(200).end())
                .catch(next);
        });

    return notificationRouter;
};

module.exports = routes;
