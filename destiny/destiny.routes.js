/**
 * Created by chris on 9/25/15.
 */
const DestinyController = require('../destiny/destiny.controller'),
    AuthenticationMiddleWare = require('../authentication/authentication.middleware'),
	cors = require('cors'),
    express = require('express'),
	httpMocks = require('node-mocks-http'),
	log = require('../helpers/log');

/**
 * Destiny Routes
 * @param authenticationController
 * @param destinyService
 * @param userService
 * @param worldRepository
 * @returns {*}
 */
const routes = function ({ authenticationController, destinyService, userService, worldRepository }) {
    const destinyRouter = express.Router();

    /**
     * Set up routes and initialize the controller.
     * @type {DestinyController}
     */
    const destinyController = new DestinyController({ destinyService, userService, worldRepository });

	/**
	 * Authentication controller when needed.
	 * @type {AuthenticationMiddleware}
	 */
	const middleware = new AuthenticationMiddleWare({ authenticationController })

    /**
     * Routes
     */
    destinyRouter.route('/signIn/')
        .get(cors(), (req, res) => destinyController.getAuthorizationUrl(req, res));

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
        .get(cors(), function (req, res) {
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

	/**
	 * Validate the existence and the freshness of the Bungie database.
	 */
	destinyRouter.validateManifest = function () {
		const req = httpMocks.createRequest();
		const res = httpMocks.createResponse({
			eventEmitter: require('events').EventEmitter
		});

		destinyController.upsertManifest(req, res);

		res.on('end', function () {
			log.info('destiny validateManifest returned a response status code of ' + res.statusCode);
		});
	};

	return destinyRouter;
};

module.exports = routes;
