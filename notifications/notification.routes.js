const express = require('express');
const { notificationHeaders } = require('../helpers/config');
const notificationTypes = require('./notification.types');
const NotificationController = require('./notification.controller');

/**
 * Check for expected notification headers.
 *
 * @param {*} headers
 */
function authorized(headers = []) {
    const headerNames = Object.keys(notificationHeaders);

    for (const headerName of headerNames) { // eslint-disable-line no-restricted-syntax
        if (headers[headerName] !== notificationHeaders[headerName]) {
            return false;
        }
    }

    return true;
}

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
        .post((req, res, next) => {
            const { headers, params: { subscription } } = req;

            if (!authorized(headers)) {
                res.writeHead(403);
                res.end();

                return;
            }

            notificationController.create(subscription)
                .then(() => res.status(200).end())
                .catch(next);
        });

    notificationRouter.route('/:subscription/:phoneNumber')
        .post((req, res, next) => {
            const { headers, params: { subscription, phoneNumber } } = req;

            if (!authorized(headers)) {
                res.writeHead(403);
                res.end();

                return;
            }

            if (!notificationTypes[subscription]) {
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
