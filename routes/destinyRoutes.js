/**
 * Created by chris on 9/25/15.
 */
var bungie = require('../settings/bungie.json'),
    bunyan = require('bunyan'),
    DestinyController = require('../controllers/destinyController'),
    express = require('express');

var routes = function () {
    'use strict';
    var destinyRouter = express.Router();
    /**
     * Notification Log
     */
    var loggingProvider = bunyan.createLogger({
        name: 'destiny-ghost-api',
        streams: [
            {
                level: 'info',
                path: './logs/destiny-ghost-api-destiny.log'
            }
        ]
    });
    /**
     * Set up routes and initialize the controller.
     * @type {destinyController|exports|module.exports}
     */
    var destinyController = new DestinyController(loggingProvider);
    /**
     * Routes
     */
    destinyRouter.route('/characters/')
        .get(destinyController.getCharacters);
    destinyRouter.route('/:membershipType/characters/:displayName')
        .get(destinyController.getCharacters);
    destinyRouter.route('/currentUser/')
        .get(destinyController.getCurrentUser);
    destinyRouter.route('/fieldTestWeapons/')
        .get(destinyController.getFieldTestWeapons);
    destinyRouter.route('/foundryOrders/')
        .get(destinyController.getFoundryOrders);
    destinyRouter.route('/ironBannerEventRewards/')
        .get(destinyController.getIronBannerEventRewards);
    destinyRouter.route('/xur/')
        .get(destinyController.getXur);
    return destinyRouter;
};

module.exports = routes;
