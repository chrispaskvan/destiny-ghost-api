/**
 * Created by chris on 9/25/15.
 */
var bunyan = require('bunyan'),
    DestinyController = require('../destiny/destiny.controller'),
    express = require('express');

var routes = function (authenticateUser, destinyService, userService, worldRepository) {
    'use strict';
    var destinyRouter = express.Router();
    /**
     * Notification Log
     */
    var loggingProvider = bunyan.createLogger({ // ToDo
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
    var destinyController = new DestinyController(destinyService, loggingProvider, userService, worldRepository);
    /**
     * Routes
     */
    destinyRouter.route('/signIn/')
        .get(function (req, res) {
            destinyController.getAuthorizationUrl(req, res);
        });
    destinyRouter.route('/characters')
        .get(authenticateUser, function (req, res) {
            destinyController.getCharacters(req, res);
        });
    destinyRouter.route('/currentUser/')
        .get(function (req, res) {
            destinyController.getCurrentUser(req, res);
        });
    destinyRouter.route('/fieldTestWeapons/')
        .get(authenticateUser, function (req, res) {
            destinyController.getFieldTestWeapons(req, res);
        });
    destinyRouter.route('/foundryOrders/')
        .get(authenticateUser, function (req, res) {
            destinyController.getFoundryOrders(req, res);
        });
    destinyRouter.route('/grimoireCards/:numberOfCards')
        .get(function (req, res) {
            destinyController.getGrimoireCards(req, res);
        });
    destinyRouter.route('/ironBannerEventRewards/')
        .get(function (req, res) {
            destinyController.getIronBannerEventRewards(req, res);
        });
    destinyRouter.route('/xur/')
        .get(function (req, res) {
            destinyController.getXur(req, res);
        });
    return destinyRouter;
};

module.exports = routes;
