/**
 * Created by chris on 9/25/15.
 */
const Destiny2Controller = require('../destiny2/destiny2.controller'),
	AuthenticationMiddleWare = require('../authentication/authentication.middleware'),
	express = require('express');

/**
 * Destiny Routes
 * @param authenticationController
 * @param destiny2Service
 * @param userService
 * @param worldRepository
 * @returns {*}
 */
const routes = function (authenticationController, destiny2Service, userService, worldRepository) {
    const destiny2Router = express.Router();

    /**
     * Set up routes and initialize the controller.
     * @type {DestinyController}
     */
    const destiny2Controller = new Destiny2Controller({ destinyService: destiny2Service, userService, worldRepository });

	/**
	 * Authentication controller when needed.
	 * @type {AuthenticationMiddleware}
	 */
	const middleware = new AuthenticationMiddleWare(authenticationController);

    /**
     * Routes
     */
    destiny2Router.route('/leaderboard')
		.get(function (req, res, next) {
			middleware.authenticateUser(req, res, next);
		}, function (req, res) {
			destiny2Controller.getLeaderboard(req, res);
		});
    destiny2Router.route('/manifest')
        .get(function (req, res) {
            destiny2Controller.getManifest(req, res);
        });
    destiny2Router.route('/manifest')
        .put(function (req, res) {
            destiny2Controller.upsertManifest(req, res);
        });
    destiny2Router.route('/profile')
		.get(function (req, res, next) {
			middleware.authenticateUser(req, res, next);
		}, function (req, res) {
			destiny2Controller.getProfile(req, res);
		});

    return destiny2Router;
};

module.exports = routes;
