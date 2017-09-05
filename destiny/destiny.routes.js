/**
 * Created by chris on 9/25/15.
 */
const DestinyController = require('../destiny/destiny.controller'),
    AuthenticationMiddleWare = require('../authentication/authentication.middleware'),
    express = require('express');
/**
 * Destiny Routes
 * @param authenticateUser
 * @param destinyService
 * @param userService
 * @param worldRepository
 * @returns {*}
 */
var routes = function (authenticationController, destinyService, userService, worldRepository) {
    'use strict';
    var destinyRouter = express.Router();
    /**
     * Set up routes and initialize the controller.
     * @type {DestinyController}
     */
    var destinyController = new DestinyController({ destinyService, userService, worldRepository});
    const middleware = new AuthenticationMiddleWare(authenticationController)
    /**
     * Routes
     */
    destinyRouter.route('/signIn/')
        .get(function (req, res) {
            destinyController.getAuthorizationUrl(req, res);
        });
    destinyRouter.route('/characters')
        .get(function (req, res, next) {
            middleware.authenticateUser(req, res, next);
        }, function (req, res) {
            destinyController.getCharacters(req, res);
        });
    destinyRouter.route('/currentUser/')
        .get(function (req, res) {
            destinyController.getCurrentUser(req, res);
        });
    destinyRouter.route('/fieldTestWeapons/')
        .get(function (req, res, next) {
            middleware.authenticateUser(req, res, next);
        }, function (req, res) {
            destinyController.getFieldTestWeapons(req, res);
        });
    destinyRouter.route('/foundryOrders/')
        .get(function (req, res, next) {
            middleware.authenticateUser(req, res, next);
        }, function (req, res) {
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
    destinyRouter.route('/manifest')
        .get(function (req, res) {
            destinyController.upsertManifest(req, res);
        });
    destinyRouter.route('/xur/')
        .get(function (req, res) {
            destinyController.getXur(req, res);
        });
    return destinyRouter;
};

module.exports = routes;
