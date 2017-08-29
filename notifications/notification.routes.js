/**
 * Created by chris on 9/25/15.
 */
var bunyan = require('bunyan'),
    DestinyController = require('../destiny/destiny.controller'),
    express = require('express'),
    NotificationController = require('../notifications/notification.controller');

var routes = function (authenticationController, destinyService, notificationService, userService, worldRepository) {
    'use strict';
    var notificationRouter = express.Router();
    /**
     * Notification Log
     */
    var loggingProvider = bunyan.createLogger({
        name: 'destiny-ghost-api',
        streams: [
            {
                level: 'info',
                path: './logs/destiny-ghost-api-notification.log'
            }
        ]
    });
    /**
     * Set up routes and initialize the controller.
     * @type {destinyController|exports|module.exports}
     */
    var destinyController = new DestinyController(loggingProvider);
    /**
     * Initialize the controller.
     * @type {notificationController|exports|module.exports}
     */
    var notificationController = new NotificationController(destinyService, notificationService, userService, worldRepository);
    /**
     * Routes
     */
    notificationRouter.route('/:subscription')
        .post(function (req, res) {
            authenticationController.authenticate(req)
                .then(() => notificationController.create(req, res));
        });
    return notificationRouter;
};

module.exports = routes;
