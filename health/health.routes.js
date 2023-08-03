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
     * paths:
     *  /health:
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
     * paths:
     *  /health/metrics:
     *    get:
     *      summary: Get metrics on the health of the Destiny Ghost API.
     *      tags:
     *        - Health
     *      produces:
     *        - application/json
     *      responses:
     *        200:
     *          description: Returns measurements.
     */
    healthRouter.route('/metrics')
        .get((req, res, next) => {
            healthController.getMetrics()
                .then(metrics => {
                    res.status(StatusCodes.OK).json(metrics);
                })
                .catch(next);
        });

    return healthRouter;
};

export default routes;
