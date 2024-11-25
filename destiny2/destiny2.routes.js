/**
 * Created by chris on 9/25/15.
 */
import { StatusCodes } from 'http-status-codes';
import cors from 'cors';
import { Router } from 'express';
import AuthenticationMiddleware from '../authentication/authentication.middleware';
import Destiny2Controller from './destiny2.controller';
import authorizeUser from '../authorization/authorization.middleware';
import getMaxAgeFromCacheControl from '../helpers/get-max-age-from-cache-control';

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
     *  /destiny2/characters:
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
        .get(async (req, res, next) => await middleware.authenticateUser(req, res, next),
            async (req, res, next) => {
                try {
                    const { session: { displayName, membershipType } } = req;
                    const characterBases = await destiny2Controller.getCharacters(displayName, membershipType);

                    res.json(characterBases);
                } catch (err) {
                    next(err);
                }
            },
        );

    /**
     * @swagger
     * paths:
     *  /destiny2/inventory:
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
        .get(async (req, res, next) => await authorizeUser(req, res, next),
            async (req, res, next) => {
                try {
                    const items = await destiny2Controller.getInventory()
                    let page = parseInt(req.query.page, 10);
                    let size = parseInt(req.query.size, 10);

                    if (Number.isNaN(page) && Number.isNaN(size)) {
                        let first = true;

                        res.writeHead(StatusCodes.OK, {
                            'Content-Type': 'application/json',
                            'Transfer-Encoding': 'chunked',
                        });

                        items.forEach(value => {
                            res.write(first ? `[${JSON.stringify(value)}` : `,${JSON.stringify(value)}`);
                            first = false;
                        });
                        res.write(']');
                        res.end();
                    } else {
                        if (Number.isNaN(page)) page = 1;
                        if (Number.isNaN(size)) size = 11;

                        const data = items.slice(0, size);
                        const pages = Math.ceil(items.length / size);

                        res.status(StatusCodes.OK).json({
                            data,
                            links: {
                                next: page === pages ? undefined : `${process.env.PROTOCOL}://${process.env.DOMAIN}/destiny2/inventory?page=${page + 1}&size=${size}`,
                            },
                            page: {
                                size,
                                total: items.length,
                                pages,
                                number: page,
                            },
                        });
                    }
                } catch (err) {
                    next(err);
                }
            });

    /**
     * @swagger
     * paths:
     *  /destiny2/manifest:
     *    get:
     *      summary: Get details about the latest Destiny 2 manifest definition.
     *      tags:
     *        - Destiny 2
     *      parameters:
     *        - name: If-Modified-Since
     *          in: head
     *      produces:
     *        - application/json
     *      responses:
     *        200:
     *          description: Returns the Destiny Manifest definition.
     */
    destiny2Router.route('/manifest')
        .get(async (req, res, next) => {
            const cacheControl = req.headers['cache-control'];
            const skipCache = cacheControl && (getMaxAgeFromCacheControl(cacheControl) === 0
                || cacheControl.split(',').includes('no-cache'));

            res.locals.skipCache = skipCache;
            if (skipCache) {
                await authorizeUser(req, res, next);
            } else {
                next();
            }
        }, async (req, res, next) => {
            try {
                const result = await destiny2Controller.getManifest(res.locals.skipCache);
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
            } catch (err) {
                next(err);
            }
        });

    /**
     * @swagger
     * paths:
     *  /destiny2/manifest:
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
        .post(async (req, res, next) => await authorizeUser(req, res, next),
            async (req, res, next) => {
                try {
                    const { data: { manifest } } = destiny2Controller.upsertManifest()

                    res.status(StatusCodes.OK).json(manifest);
                } catch (err) {
                    next(err);
                }
            });

    /**
     * @swagger
     * paths:
     *  /destiny2/xur:
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
        .get(cors(configuration.cors),
            async (req, res, next) => await middleware.authenticateUser(req, res, next),
            async (req, res, next) => {
                try {
                    const { session: { displayName, membershipType } } = req;
                    const items = await destiny2Controller.getXur(displayName, membershipType);

                    if (items) {
                        return res.status(StatusCodes.OK).json(items);
                    }

                    return res.status(StatusCodes.NOT_FOUND);
                } catch (err) {
                    next(err);
                }
            },
        );

    return destiny2Router;
};

export default routes;
