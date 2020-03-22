/**
 * Created by chris on 9/25/15.
 */
const cors = require('cors');
const express = require('express');
const DestinyController = require('../destiny/destiny.controller');
const AuthenticationMiddleWare = require('../authentication/authentication.middleware');

/**
 * Destiny Routes
 * @param authenticationController
 * @param destinyService
 * @param userService
 * @param worldRepository
 * @returns {*}
 */
const routes = ({
    authenticationController,
    destinyService,
    userService,
    worldRepository,
}) => {
    const destinyRouter = express.Router();

    /**
     * Set up routes and initialize the controller.
     * @type {DestinyController}
     */
    const destinyController = new DestinyController({
        destinyService,
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
    destinyRouter.route('/signIn/')
        .get(cors(), (req, res, next) => destinyController.getAuthorizationUrl(req, res)
            .catch(next));

    destinyRouter.route('/characters')
        .get((req, res, next) => middleware.authenticateUser(req, res, next),
            (req, res, next) => destinyController.getCharacters(req, res)
                .catch(next));

    destinyRouter.route('/currentUser/')
        .get((req, res, next) => destinyController.getCurrentUser(req, res)
            .catch(next));

    destinyRouter.route('/grimoireCards/:numberOfCards')
        .get(cors(),
            (req, res, next) => destinyController.getGrimoireCards(req, res)
                .catch(next));

    destinyRouter.route('/manifest')
        .get((req, res, next) => destinyController.getManifest(req, res)
            .catch(next));

    destinyRouter.route('/manifest')
        .post((req, res, next) => destinyController.upsertManifest(req, res)
            .catch(next));

    return destinyRouter;
};

module.exports = routes;
