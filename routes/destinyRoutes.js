/**
 * Created by chris on 9/25/15.
 */
'use strict';
var DestinyController = require('../controllers/destinyController'),
    express = require('express'),
    NotificationController = require('../controllers/notificationController');

var routes = function () {
    var destinyRouter = express.Router();
    /**
     * Set up routes and initialize the controller.
     * @type {destinyController|exports|module.exports}
     */
    var destinyController = new DestinyController();
    destinyRouter.route('/characters/')
        .get(destinyController.getCharacters);
    destinyRouter.route('/fieldTestWeapons/')
        .get(destinyController.getFieldTestWeapons);
    destinyRouter.route('/foundryOrders/')
        .get(destinyController.getFoundryOrders);
    destinyRouter.route('/ironBannerEventRewards/')
        .get(destinyController.getIronBannerEventRewards);
    destinyRouter.route('/xur/')
        .get(destinyController.getXur);
    /**
     * Initialize the controller.
     * @type {notificationController|exports|module.exports}
     */
    var notificationController = new NotificationController();
    notificationController.init('./settings/ShadowUser.json');
    return destinyRouter;
};

module.exports = routes;