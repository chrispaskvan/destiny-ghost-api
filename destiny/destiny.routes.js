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
const routes = ({ authenticationController, destinyService, userService, worldRepository }) => {
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

    destinyRouter.route('/fieldTestWeapons/')
        .get((req, res, next) => middleware.authenticateUser(req, res, next),
            (req, res, next) => destinyController.getFieldTestWeapons(req, res)
                .catch(next));

    destinyRouter.route('/foundryOrders/')
        .get((req, res, next) => middleware.authenticateUser(req, res, next),
            (req, res, next) => destinyController.getFoundryOrders(req, res)
                .catch(next));

    destinyRouter.route('/grimoireCards/:numberOfCards')
        .get(cors(),
            (req, res, next) => destinyController.getGrimoireCards(req, res)
                .catch(next));

    destinyRouter.route('/ironBannerEventRewards/')
        .get((req, res, next) => destinyController.getIronBannerEventRewards(req, res)
            .catch(next));

    destinyRouter.route('/manifest')
        .get((req, res, next) => destinyController.getManifest(req, res)
            .catch(next));

    destinyRouter.route('/manifest')
        .post((req, res, next) => destinyController.upsertManifest(req, res)
            .catch(next));

    destinyRouter.route('/xur/')
        .get((req, res, next) => destinyController.getXur(req, res)
            .catch(next));

    /**
     * Validate the existence and the freshness of the Bungie database.
     */
    destinyRouter.validateManifest = () => {
        const req = httpMocks.createRequest();
        const res = httpMocks.createResponse({
            eventEmitter: require('events').EventEmitter
        });

        destinyController.upsertManifest(req, res);

        res.on('end', () => {
            log.info(`destiny validateManifest responded with a status code of ${res.statusCode}`);
        });
    };

    return destinyRouter;
};

module.exports = routes;
