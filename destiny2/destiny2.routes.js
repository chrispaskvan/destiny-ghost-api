/**
 * Created by chris on 9/25/15.
 */
const AuthenticationMiddleWare = require('../authentication/authentication.middleware'),
	Destiny2Controller = require('./destiny2.controller'),
	cors = require('cors'),
	corsConfig = require('../settings/cors.' + process.env.NODE_ENV + '.json'),
	express = require('express'),
	httpMocks = require('node-mocks-http'),
	log = require('../helpers/log');

/**
 * Destiny Routes
 * @param authenticationController
 * @param destiny2Service
 * @param userService
 * @param worldRepository
 * @returns {*}
 */
const routes = function ({ authenticationController, destiny2Service, userService, worldRepository }) {
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
	const middleware = new AuthenticationMiddleWare({ authenticationController });

    /**
     * Routes
     */
    destiny2Router.route('/leaderboard')
		.get(cors(corsConfig), function (req, res, next) {
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
		.get(cors(corsConfig), function (req, res, next) {
			middleware.authenticateUser(req, res, next);
		}, function (req, res) {
			destiny2Controller.getProfile(req, res);
		});
	destiny2Router.route('/xur')
		.get(cors(corsConfig), function (req, res, next) {
			middleware.authenticateUser(req, res, next);
		}, function (req, res) {
			destiny2Controller.getXur(req, res);
		});

	/**
	 * Validate the existence and the freshness of the Bungie database.
	 */
	destiny2Router.validateManifest = function () {
		const req = httpMocks.createRequest();
		const res = httpMocks.createResponse({
			eventEmitter: require('events').EventEmitter
		});

		destiny2Controller.upsertManifest(req, res);

		res.on('end', function () {
			log.info('destiny 2 validateManifest returned a response status code of ' + res.statusCode);
		});
	};

    return destiny2Router;
};

module.exports = routes;
