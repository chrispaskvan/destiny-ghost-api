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
        .get(cors(),
            async (req, res) => {
                const { state, url } = await destinyController.getAuthorizationUrl();

                req.session.state = state;
                res.send(url);
            });

    /**
     * @openapi
     * paths:
     *  /destiny/grimoireCards/{numberOfCards}:
     *    get:
     *      summary: Get a random selection of Grimoire Cards.
     *      operationId: getDestinyGrimoireCards
     *      tags:
     *        - Destiny
     *      parameters:
     *        - in: path
     *          name: numberOfCards
     *          schema:
     *            type: integer
     *            minimum: 1
     *            maximum: 10
     *          required: true
     *          description: The number of cards to return. (Max. 10)
     *      responses:
     *        200:
     *          description: Returns a random selection of Grimoire Cards.
     *          headers:
     *            'X-Request-Id':
     *              description: Unique identifier assigned when not provided.
     *              schema:
     *                type: string
     *            'X-Trace-Id':
     *              description: Unique identifier assigned.
     *              schema:
     *                type: string
     *            'X-RateLimit-Limit':
     *              description: Number of requests allowed in the current period.
     *              schema:
     *                type: number
     *            'X-RateLimit-Remaining':
     *              description: Number of requests remaining in the current period.
     *              schema:
     *                type: number
     *            'X-RateLimit-Reset':
     *              description: Time at which the current period ends.
     *              schema:
     *                type: string
     *        400:
     *          description: Invalid whole number outside the range of 1 to 10.
     *        422:
     *          description: Unrecognized whole number.
     */
    destinyRouter.route('/grimoireCards/:numberOfCards')
        .get(cors(),
            async (req, res) => {
                const { params: { numberOfCards } } = req;
                const count = parseInt(numberOfCards, 10);

                if (Number.isNaN(count)) {
                    return res.status(StatusCodes.UNPROCESSABLE_ENTITY).end();
                }

                if (count < 1 || count > 10) {
                    return res.status(StatusCodes.BAD_REQUEST)
                        .send('Must be a whole number less than or equal to 10.');
                }

                const grimoireCards = await destinyController.getGrimoireCards(count);
                res.status(StatusCodes.OK).json(grimoireCards);
            },
        );

    /**
     * @openapi
     * paths:
     *  /destiny/manifest:
     *    get:
     *      summary: Get details about the latest Destiny manifest definition.
     *      operationId: getDestinyManifest
     *      tags:
     *        - Destiny
     *      parameters:
     *        - name: Cache-Control
     *          in: header
     *          required: false
     *          schema:
     *            type: string
     *        - name: If-Modified-Since
     *          in: header
     *          description: 'Return not modified if the manifest has not changed since the date and time provided.'
     *          required: false
     *          schema:
     *            type: string
     *      responses:
     *        200:
     *          description: Returns the Destiny Manifest definition.
     *          headers:
     *            'Last-Modified':
     *              description: The date and time the manifest was last modified.
     *              schema:
     *                type: string
     *            'Cache-Control':
     *              description: The cache control header.
     *              schema:
     *                type: string
     *        304:
     *          description: Not Modified
     *          headers:
     *            'Last-Modified':
     *              description: The date and time the manifest was last modified.
     *              schema:
     *                type: string
     *            'Cache-Control':
     *              description: The cache control header.
     *              schema:
     *                type: string
     */
    destinyRouter.route('/manifest')
        .get(async (req, res, next) => {
            const cacheControl = req.headers['cache-control'];
            const skipCache = cacheControl && (getMaxAgeFromCacheControl(cacheControl) === 0
                || cacheControl.split(',').includes('no-cache'));

            res.locals.skipCache = skipCache;
            if (skipCache) {
                authorizeUser(req, res, next);
            } else {
                next();
            }
        }, async (req, res) => {
            const result = await destinyController.getManifest(res.locals.skipCache);
            const {
                data: {
                    manifest,
                },
                meta: {
                    lastModified,
                    maxAge,
                },
            } = result;
            const ifModifiedSince = new Date(req.headers['if-modified-since'] ?? null);

            res.set({
                'Last-Modified': lastModified,
                'Cache-Control': `max-age=${maxAge}`,
            });
            res.status(ifModifiedSince > new Date(lastModified)
                ? StatusCodes.NOT_MODIFIED : StatusCodes.OK)
                .json(manifest);
        });

    /**
     * @openapi
     * paths:
     *  /destiny/manifest:
     *    post:
     *      summary: Download the latest Destiny manifest if the local copy is outdated.
     *      operationId: downloadDestinyManifest
     *      tags:
     *        - Destiny
     *      security:
     *        - authorizationKey: []
     *      responses:
     *        200:
     *          description: Returns the Destiny Manifest definition.
     */
    destinyRouter.route('/manifest')
        .post(authorizeUser,
            async (req, res) => {
                const manifest = await destinyController.upsertManifest();

                res.status(StatusCodes.OK).json(manifest);
            });

    return destinyRouter;
};

export default routes;
