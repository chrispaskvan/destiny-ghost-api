/**
 * Created by chris on 9/25/15.
 */
var bunyan = require('bunyan'),
    DestinyController = require('../destiny/destiny.controller'),
    express = require('express'),
    NotificationController = require('../notifications/notification.controller');

var routes = function () {
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
    var notificationController = new NotificationController(loggingProvider);
    /**
     * Routes
     */
    notificationRouter.route('/:subscription')
        .post(function (req, res) {
            /**
             * Check for any changes to the Bungie Destiny manifest definition.
             */
            destinyController.upsertManifest()
                .fail(function (err) {
                    loggingProvider.info(err);
                })
                .fin(function () {
                    notificationController.createNotifications(req, res);
                });
        });
    notificationRouter.route('/:subscription/:phoneNumber')
        .post(function (req, res) {
            notificationController.createNotificationsForUser(req, res);
        });
    return notificationRouter;
};

module.exports = routes;