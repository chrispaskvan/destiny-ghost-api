/**
 * Created by chris on 9/25/15.
 */
var bunyan = require('bunyan'),
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
    destinyRouter.route('/:membershipType/characters/:displayName')
        .get(function (req, res) {
            destinyController.getCharacters(req, res);
        });
    destinyRouter.route('/currentUser/')
        .get(function (req, res) {
            destinyController.getCurrentUser(req, res);
        });
    destinyRouter.route('/fieldTestWeapons/')
        .get(function (req, res) {
            destinyController.getFieldTestWeapons(req, res);
        });
    destinyRouter.route('/foundryOrders/')
        .get(function (req, res) {
            destinyController.getFoundryOrders(req, res);
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
