/**
 * Created by chris on 9/25/15.
 */
const HttpStatus = require('http-status-codes');
const cors = require('cors');
const express = require('express');
const DestinyController = require('./destiny.controller');

/**
 * Destiny Routes
 *
 * @param authenticationController
 * @param destinyService
 * @param userService
 * @param worldRepository
 * @returns {*}
 */
const routes = ({
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

    destinyRouter.route('/signIn/')
        .get(cors(), (req, res, next) => {
            destinyController.getAuthorizationUrl()
                .then(({ state, url }) => {
                    req.session.state = state;
                    res.send(url);
                })
                .catch(next);
        });

    /**
     * @swagger
     * path:
     *  /destiny/currentUser/:
     *    get:
     *      summary: Get the currently authenticated user.
     *      tags:
     *        - Destiny
     *      produces:
     *        - application/json
     *      responses:
     *        200:
     *          description: Returns current user details.
     *        401:
     *          description: Unauthorized
     */
    destinyRouter.route('/currentUser/')
        .get((req, res, next) => {
            const { session: { displayName, membershipType } } = req;

            if (!displayName || !membershipType) {
                return res.status(HttpStatus.StatusCodes.UNAUTHORIZED).end();
            }

            return destinyController.getCurrentUser(displayName, membershipType)
                .then(bungieUser => {
                    res.json(bungieUser);
                })
                .catch(next);
        });

    destinyRouter.route('/grimoireCards/:numberOfCards')
        .get(
            cors(),
            (req, res, next) => {
                const { params: { numberOfCards } } = req;
                const count = parseInt(numberOfCards, 10);

                if (Number.isNaN(count)) {
                    return res.status(HttpStatus.StatusCodes.UNPROCESSABLE_ENTITY).end();
                }

                return destinyController.getGrimoireCards(count)
                    .then(grimoireCards => {
                        res.status(HttpStatus.StatusCodes.OK).json(grimoireCards);
                    })
                    .catch(next);
            },
        );

    /**
     * @swagger
     * path:
     *  /destiny/manifest/:
     *    get:
     *      summary: Get details about the latest and greatest Destiny manifest definition.
     *      tags:
     *        - Destiny
     *      produces:
     *        - application/json
     *      responses:
     *        200:
     *          description: Returns the Destiny Manifest definition.
     */
    destinyRouter.route('/manifest')
        .get((req, res, next) => {
            destinyController.getManifest(req, res)
                .then(manifest => {
                    res.status(HttpStatus.StatusCodes.OK).json(manifest);
                })
                .catch(next);
        });

    destinyRouter.route('/manifest')
        .post((req, res, next) => {
            destinyController.upsertManifest()
                .then(manifest => {
                    res.status(HttpStatus.StatusCodes.OK).json(manifest);
                })
                .catch(next);
        });

    return destinyRouter;
};

module.exports = routes;
