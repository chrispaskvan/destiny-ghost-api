/**
 * Created by chris on 9/25/15.
 */
const HttpStatus = require('http-status-codes');
const cors = require('cors');
const express = require('express');
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
     * @swagger
     * path:
     *  /destiny2/characters/:
     *    get:
     *      summary: Get a list of the user's characters.
     *      tags:
     *        - Destiny 2
     *      produces:
     *        - application/json
     *      responses:
     *        200:
     *          description: Destiny Manifest definition
     */
    destiny2Router.route('/characters')
        .get((req, res, next) => middleware.authenticateUser(req, res, next),
            (req, res, next) => {
                const { session: { displayName, membershipType } } = req;

                destiny2Controller.getCharacters(displayName, membershipType)
                    .then(characterBases => {
                        res.json(characterBases);
                    })
                    .catch(next);
            });

    /**
     * @swagger
     * path:
     *  /destiny2/manifest/:
     *    get:
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
        .get((req, res, next) => {
            destiny2Controller.getManifest()
                .then(manifest => {
                    res.status(HttpStatus.OK).json(manifest);
                })
                .catch(next);
        });

    destiny2Router.route('/manifest')
        .post((req, res, next) => {
            destiny2Controller.upsertManifest()
                .then(manifest => {
                    res.status(HttpStatus.OK).json(manifest);
                })
                .catch(next);
        });

    destiny2Router.route('/player/:displayName')
        .get((req, res, next) => {
            const { params: { displayName } } = req;

            destiny2Controller.getPlayer(displayName)
                .then(statistics => {
                    if (statistics) {
                        return res.status(200).json(statistics);
                    }

                    return res.status(HttpStatus.UNAUTHORIZED).end();
                })
                .catch(next);
        });

    /**
     * @swagger
     * path:
     *  /destiny2/xur/:
     *    get:
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
            (req, res, next) => {
                const { session: { displayName, membershipType } } = req;

                destiny2Controller.getXur(displayName, membershipType)
                    .then(items => {
                        if (items) {
                            return res.status(HttpStatus.OK).json(items);
                        }

                        return res.status(HttpStatus.NOT_FOUND);
                    })
                    .catch(next);
            });

    return destiny2Router;
};

module.exports = routes;
