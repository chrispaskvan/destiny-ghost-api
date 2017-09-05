/**
 * Created by chris on 9/25/15.
 */
var bunyan = require('bunyan'),
    express = require('express'),
    NotificationController = require('../notifications/notification.controller');

var routes = function (destinyService, notificationService, userService, worldRepository) {
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
     * Initialize the controller.
     * @type {NotificationController}
     */
    var notificationController = new NotificationController(
        { destinyService, notificationService, userService, worldRepository});

    /**
     * Routes
     */
    notificationRouter.route('/:notificationType')
        .post(function (req, res) {
            notificationController.create(req, res);
        });
    return notificationRouter;
};

module.exports = routes;
