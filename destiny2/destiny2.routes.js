/**
 * Created by chris on 9/25/15.
 */
import { StatusCodes } from 'http-status-codes';
import cors from 'cors';
import { Router } from 'express';
import AuthenticationMiddleware from '../authentication/authentication.middleware';
import Destiny2Controller from './destiny2.controller';
import authorizeUser from '../authorization/authorization.middleware';

import configuration from '../helpers/config';

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
    const destiny2Router = Router();

    /**
     * Set up routes and initialize the controller.
     * @type {Destiny2Controller}
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
    const middleware = new AuthenticationMiddleware({ authenticationController });

    /**
     * @swagger
     * paths:
     *  /destiny2/characters/:
     *    get:
     *      summary: Get a list of the user's characters.
     *      tags:
     *        - Destiny 2
     *      produces:
     *        - application/json
     *      responses:
     *        200:
     *          description: Returns the current user's list of characters.
     *        401:
     *          description: Unauthorized
     */
    destiny2Router.route('/characters')
        .get(
            (req, res, next) => middleware.authenticateUser(req, res, next),
            (req, res, next) => {
                const { session: { displayName, membershipType } } = req;

                destiny2Controller.getCharacters(displayName, membershipType)
                    .then(characterBases => {
                        res.json(characterBases);
                    })
                    .catch(next);
            },
        );

    /**
     * @swagger
     * paths:
     *  /destiny2/inventory/:
     *    get:
     *      summary: Get the complete inventory of items.
     *      tags:
     *        - Destiny 2
     *      produces:
     *        - application/json
     *      responses:
     *        200:
     *          description: Returns the complete Destiny 2 item inventory.
     */
    destiny2Router.route('/inventory')
        .get((req, res, next) => {
            destiny2Controller.getInventory()
                .then(items => {
                    let first = true;

                    res.setHeader('Content-Type', 'application/json');
                    res.setHeader('Transfer-Encoding', 'chunked');

                    items.forEach(value => {
                        res.write(first ? `[${JSON.stringify(value)}` : `,${JSON.stringify(value)}`);
                        first = false;
                    });
                    res.write(']');
                    res.status(StatusCodes.OK).end();
                })
                .catch(next);
        });

    /**
     * @swagger
     * paths:
     *  /destiny2/manifest/:
     *    get:
     *      summary: Get details about the latest Destiny 2 manifest definition.
     *      tags:
     *        - Destiny 2
     *      produces:
     *        - application/json
     *      responses:
     *        200:
     *          description: Returns the Destiny Manifest definition.
     */
    destiny2Router.route('/manifest')
        .get((req, res, next) => {
            destiny2Controller.getManifest()
                .then(manifest => {
                    res.status(StatusCodes.OK).json(manifest);
                })
                .catch(next);
        });

    /**
     * @swagger
     * paths:
     *  /destiny2/manifest/:
     *    post:
     *      summary: Download the latest Destiny2 manifest if the local copy is outdated.
     *      tags:
     *        - Destiny 2
     *      produces:
     *        - application/json
     *      responses:
     *        200:
     *          description: Returns the Destiny Manifest definition.
     *        403:
     *          description: Forbidden
     */
    destiny2Router.route('/manifest')
        .post((req, res, next) => authorizeUser(req, res, next), (req, res, next) => {
            destiny2Controller.upsertManifest()
                .then(manifest => {
                    res.status(StatusCodes.OK).json(manifest);
                })
                .catch(next);
        });

    /**
     * @swagger
     * paths:
     *  /destiny2/xur/:
     *    get:
     *      summary: Get Xur's inventory if available.
     *      tags:
     *        - Destiny 2
     *      produces:
     *        - application/json
     *      responses:
     *        200:
     *          description: Returns Xur's inventory.
     *        401:
     *          description: Unauthorized
     *        404:
     *          description: Xur could not be found.
     */
    destiny2Router.route('/xur')
        .get(
            cors(configuration.cors),
            (req, res, next) => middleware.authenticateUser(req, res, next),
            (req, res, next) => {
                const { session: { displayName, membershipType } } = req;

                destiny2Controller.getXur(displayName, membershipType)
                    .then(items => {
                        if (items) {
                            return res.status(StatusCodes.OK).json(items);
                        }

                        return res.status(StatusCodes.NOT_FOUND);
                    })
                    .catch(next);
            },
        );

    return destiny2Router;
};

export default routes;
