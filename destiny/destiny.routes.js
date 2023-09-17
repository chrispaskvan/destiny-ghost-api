/**
 * Created by chris on 9/25/15.
 */
import { StatusCodes } from 'http-status-codes';
import cors from 'cors';
import { Router } from 'express';
import DestinyController from './destiny.controller';
import authorizeUser from '../authorization/authorization.middleware';
import getMaxAgeFromCacheControl from '../helpers/get-max-age-from-cache-control';

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
    const destinyRouter = Router();

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
     * paths:
     *  /destiny/currentUser:
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
                return res.status(StatusCodes.UNAUTHORIZED).end();
            }

            return destinyController.getCurrentUser(displayName, membershipType)
                .then(bungieUser => {
                    res.json(bungieUser);
                })
                .catch(next);
        });

    /**
     * @swagger
     * paths:
     *  /destiny/grimoireCards/{numberOfCards}:
     *    get:
     *      summary: Get a random selection of Grimoire Cards.
     *      tags:
     *        - Destiny
     *      parameters:
     *        - in: path
     *          name: numberOfCards
     *          schema:
     *            type: number
     *          required: true
     *          description: The number of cards to return. (Max. 10)
     *      produces:
     *        - application/json
     *      responses:
     *        200:
     *          description: Returns a random selection of Grimoire Cards.
     *        400:
     *          description: Invalid whole number between 1 and 10.
     *        422:
     *          description: Unrecognized whole number.
     */
    destinyRouter.route('/grimoireCards/:numberOfCards')
        .get(
            cors(),
            (req, res, next) => {
                const { params: { numberOfCards } } = req;
                const count = parseInt(numberOfCards, 10);

                if (Number.isNaN(count)) {
                    return res.status(StatusCodes.UNPROCESSABLE_ENTITY).end();
                }

                if (count < 1 || count > 10) {
                    return res.status(StatusCodes.BAD_REQUEST)
                        .send('Must be a whole number less than or equal to 10.');
                }

                return destinyController.getGrimoireCards(count)
                    .then(grimoireCards => {
                        res.status(StatusCodes.OK).json(grimoireCards);
                    })
                    .catch(next);
            },
        );

    /**
     * @swagger
     * paths:
     *  /destiny/manifest:
     *    get:
     *      summary: Get details about the latest Destiny manifest definition.
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
            const cacheControl = req.headers['cache-control'];
            const skipCache = cacheControl && (getMaxAgeFromCacheControl(cacheControl) === 0
                || cacheControl.split(',').includes('no-cache'));

            res.locals.skipCache = skipCache;
            if (skipCache) {
                authorizeUser(req, res, next);
            } else {
                next();
            }
        }, (req, res, next) => {
            destinyController.getManifest(res.locals.skipCache)
                .then(result => {
                    const {
                        lastModified,
                        manifest,
                        maxAge,
                        wasCached,
                    } = result;

                    res.set({
                        'Last-Modified': lastModified,
                        'Cache-Control': `max-age=${maxAge}`,
                    });
                    res.status(wasCached ? StatusCodes.NOT_MODIFIED : StatusCodes.OK)
                        .json(manifest);
                })
                .catch(next);
        });

    /**
     * @swagger
     * paths:
     *  /destiny/manifest:
     *    post:
     *      summary: Download the latest Destiny manifest if the local copy is outdated.
     *      tags:
     *        - Destiny
     *      produces:
     *        - application/json
     *      responses:
     *        200:
     *          description: Returns the Destiny Manifest definition.
     */
    destinyRouter.route('/manifest')
        .post((req, res, next) => {
            destinyController.upsertManifest()
                .then(manifest => {
                    res.status(StatusCodes.OK).json(manifest);
                })
                .catch(next);
        });

    return destinyRouter;
};

export default routes;
