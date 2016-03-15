/**
 * Created by chris on 9/25/15.
 */
'use strict';
var DestinyController = require('../controllers/destinyController'),
    express = require('express'),
    NotificationController = require('../controllers/notificationController');

var routes = function () {
    var notificationRouter = express.Router();
    /**
     * Set up routes and initialize the controller.
     * @type {destinyController|exports|module.exports}
     */
    var destinyController = new DestinyController();
    /**
     * Check for any changes to the Bungie Destiny manifest definition.
     */
    destinyController.upsertManifest();
    /**
     * Initialize the controller.
     * @type {notificationController|exports|module.exports}
     */
    var notificationController = new NotificationController();
    /**
     * Routes
     */
    notificationRouter.route('/:subscription')
        .post(notificationController.create);
    notificationController.init('./settings/shadowUser.psn.json');
    return notificationRouter;
};

module.exports = routes;