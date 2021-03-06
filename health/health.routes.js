const express = require('express');
const HttpStatus = require('http-status-codes');
const HealthController = require('./health.controller');

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
    const healthRouter = express.Router();

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
     *          description: Status reports of underlying dependencies.
     */
    healthRouter.route('/')
        .get((req, res, next) => {
            healthController.getHealth()
                .then(({ failures, health }) => {
                    res.status(failures
                        ? HttpStatus.SERVICE_UNAVAILABLE
                        : HttpStatus.OK).json(health);
                })
                .catch(next);
        });

    return healthRouter;
};

module.exports = routes;
