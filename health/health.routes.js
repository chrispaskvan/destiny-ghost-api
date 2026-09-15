// @ts-check
import { Router } from 'express';
import { StatusCodes } from 'http-status-codes';
import HealthController from './health.controller.js';

/**
 * @typedef {Object} HealthRoutesOptions
 * @property {import('../destiny/destiny.service.js').default} destinyService
 * @property {import('../destiny2/destiny2.service.js').default} destiny2Service
 * @property {import('../helpers/documents.js').default} documents
 * @property {import('../helpers/world.js').default} worldRepository
 * @property {import('../helpers/world2.js').default} world2Repository
 */

/**
 * Destiny Routes
 *
 * @param {HealthRoutesOptions} options
 * @returns {import('express').Router}
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
     * @openapi
     * paths:
     *  /health:
     *    get:
     *      summary: Get a summary of the status of the Destiny Ghost API and its dependencies.
     *      operationId: getHealth
     *      tags:
     *        - Health
     *      responses:
     *        200:
     *          description: Returns the status reports of underlying dependencies.
     *        503:
     *          description: Service is unavailable.
     */
    healthRouter.route('/').get(async (_req, res) => {
        const { failures, health } = await healthController.getHealth();

        res.status(failures ? StatusCodes.SERVICE_UNAVAILABLE : StatusCodes.OK).json(health);
    });

    /**
     * @openapi
     * paths:
     *  /health/metrics:
     *    get:
     *      summary: Get metrics on the health of the Destiny Ghost API.
     *      operationId: getHealthMetrics
     *      tags:
     *        - Health
     *      responses:
     *        200:
     *          description: Returns measurements.
     */
    healthRouter.route('/metrics').get(async (_req, res) => {
        const metrics = await healthController.getMetrics();

        res.status(StatusCodes.OK).json(metrics);
    });

    return healthRouter;
};

export default routes;
