const express = require('express');
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
     * Routes
     */
    healthRouter.route('/')
        .get((req, res, next) => healthController.getHealth(req, res)
            .catch(next));

    return healthRouter;
};

module.exports = routes;
