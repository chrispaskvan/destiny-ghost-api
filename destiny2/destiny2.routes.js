/**
 * Created by chris on 9/25/15.
 */
const { EventEmitter } = require('events');
const cors = require('cors');
const express = require('express');
const httpMocks = require('node-mocks-http');
const log = require('../helpers/log');
const AuthenticationMiddleWare = require('../authentication/authentication.middleware');
const Destiny2Controller = require('./destiny2.controller');

const { cors: corsConfig } = require('../helpers/config');

/**
 * Destiny Routes
 * @param authenticationController
 * @param destiny2Service
 * @param userService
 * @param worldRepository
 * @returns {*}
 */
const routes = ({
    authenticationController, destiny2Service, userService, worldRepository,
}) => {
    const destiny2Router = express.Router();

    /**
     * Set up routes and initialize the controller.
     * @type {DestinyController}
     */
    const destiny2Controller = new Destiny2Controller({
        destinyService: destiny2Service,
        userService,
        worldRepository,
    });

    /**
     * Authentication controller when needed.
     * @type {AuthenticationMiddleware}
     */
    const middleware = new AuthenticationMiddleWare({ authenticationController });

    /**
     * Routes
     */
    destiny2Router.route('/leaderboard')
        .get(cors(corsConfig),
            (req, res, next) => middleware.authenticateUser(req, res, next),
            (req, res, next) => destiny2Controller.getLeaderboard(req, res)
                .catch(next));

    /**
     * @swagger
     * path:
     *  /destiny2/manifest/:
     *    get:
     *      security: []
     *      summary: Get details about the latest and greatest Destiny manifest definition.
     *      tags:
     *        - Destiny 2
     *      produces:
     *        - application/json
     *      responses:
     *        200:
     *          description: Destiny Manifest definition
     */
    destiny2Router.route('/manifest')
        .get((req, res, next) => destiny2Controller.getManifest(req, res)
            .catch(next));

    destiny2Router.route('/manifest')
        .post((req, res, next) => destiny2Controller.upsertManifest(req, res)
            .catch(next));

    destiny2Router.route('/player/:displayName')
        .get((req, res, next) => destiny2Controller.getPlayer(req, res)
            .catch(next));

    destiny2Router.route('/profile')
        .get(cors(corsConfig),
            (req, res, next) => middleware.authenticateUser(req, res, next),
            (req, res, next) => destiny2Controller.getProfile(req, res)
                .catch(next));

    /**
     * @swagger
     * path:
     *  /destiny2/xur/:
     *    get:
     *      security: []
     *      summary: Get Xur's inventory if available.
     *      tags:
     *        - Destiny 2
     *      produces:
     *        - application/json
     *      responses:
     *        200:
     *          description: Xur's inventory
     */
    destiny2Router.route('/xur')
        .get(cors(corsConfig),
            (req, res, next) => middleware.authenticateUser(req, res, next),
            (req, res, next) => destiny2Controller.getXur(req, res)
                .catch(next));

    /**
     * Validate the existence and the freshness of the Bungie database.
     */
    destiny2Router.validateManifest = () => {
        const req = httpMocks.createRequest();
        const res = httpMocks.createResponse({
            eventEmitter: EventEmitter,
        });

        destiny2Controller.upsertManifest(req, res);

        res.on('end', () => {
            log.info(`destiny 2 validateManifest returned a response status code of ${res.statusCode}`);
        });
    };

    return destiny2Router;
};

module.exports = routes;
