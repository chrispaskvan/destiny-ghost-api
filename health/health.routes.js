import { Router } from 'express';
import { StatusCodes } from 'http-status-codes';
import HealthController from './health.controller';

/**
 * Destiny Routes
 * @param destinyService
 * @param destiny2Service
 * @param documents
 * @param worldRepository
 * @param world2Repository
 * @returns {*}
 */
const routes = ({
    destinyService,
    destiny2Service,
    documents,
    worldRepository,
    world2Repository,
}) => {
    const healthRouter = Router();

    /**
     * Set up routes and initialize the controller.
     * @type {HealthController}
     */
    const healthController = new HealthController({
        destinyService,
        destiny2Service,
        documents,
        worldRepository,
        world2Repository,
    });

    /**
     * @swagger
     * path:
     *  /health/:
     *    get:
     *      summary: Get a summary of the status of the Destiny Ghost API and its dependencies.
     *      tags:
     *        - Health
     *      produces:
     *        - application/json
     *      responses:
     *        200:
     *          description: Returns the status reports of underlying dependencies.
     *        503:
     *          description: Service is unavailable.
     */
    healthRouter.route('/')
        .get((req, res, next) => {
            healthController.getHealth()
                .then(({ failures, health }) => {
                    res.status(failures
                        ? StatusCodes.SERVICE_UNAVAILABLE
                        : StatusCodes.OK).json(health);
                })
                .catch(next);
        });

    /**
     * @swagger
     * path:
     *  /health/live:
     *    get:
     *      summary: Check if the server is up and responsive.
     *      tags:
     *        - Health
     *      produces:
     *        - application/json
     *      responses:
     *        200:
     *          description: Check to determine whether the server is alive and running.
     */
    healthRouter.route('/live')
        .get((req, res) => {
            res.json({
                status: 'UP',
                checks: [
                    {
                        name: 'liveliness',
                        state: 'UP',
                    },
                ],
            });
        });

    return healthRouter;
};

export default routes;
