/**
 * Route Definitions
 */
import { readFileSync } from 'fs';
import { CosmosClient } from '@azure/cosmos';
import { Router } from 'express';
import { serve, setup } from 'swagger-ui-express';
import { createHandler } from 'graphql-http/lib/use/express';
import twilio from 'twilio';

import AuthenticationController from '../authentication/authentication.controller.js';
import AuthenticationMiddleWare from '../authentication/authentication.middleware.js';
import AuthenticationService from '../authentication/authentication.service.js';
import Destiny2Cache from '../destiny2/destiny2.cache.js';
import Destiny2Controller from '../destiny2/destiny2.controller.js';
import Destiny2Service from '../destiny2/destiny2.service.js';
import DestinyCache from '../destiny/destiny.cache.js';
import DestinyService from '../destiny/destiny.service.js';
import NotificationService from '../notifications/notification.service.js';
import UserCache from '../users/user.cache.js';
import UserService from '../users/user.service.js';
import World from '../helpers/world.js';
import World2 from '../helpers/world2.js';
import client from '../helpers/cache.js';
import Documents from '../helpers/documents.js';
import configuration from '../helpers/config.js';
import DestinyRouter from '../destiny/destiny.routes.js';
import Destiny2Router from '../destiny2/destiny2.routes.js';
import HealthRouter from '../health/health.routes.js';
import Manifests from './manifests.js';
import NotificationRouter from '../notifications/notification.routes.js';
import TwilioRouter from '../twilio/twilio.routes.js';
import UserRouter from '../users/user.routes.js';
import schema from '../graphql/schema.js';
import root from '../graphql/root.js';
import pool from '../helpers/pool.js';
import McpRouter from '../mcp/mcp.routes.js';

const {
    documents: {
        authenticationKey, host,
    }, twilio: {
        accountSid, authToken,
    },
} = configuration;

export default () => {
    const routes = Router();

    /**
     * Swagger
     */
    routes.use('/docs', serve);
    routes.get(
        '/docs',
        setup(JSON.parse(readFileSync('./openapi.json')), {
            explorer: false,
        }),
    );

    /**
     * Dependencies
     */
    const destinyCache = new DestinyCache({ client });
    const destinyService = new DestinyService({
        cacheService: destinyCache,
    });
    const cosmosClient = new CosmosClient({
        endpoint: host,
        key: authenticationKey,
    });
    const documents = new Documents({ client: cosmosClient });
    const messageClient = twilio(accountSid, authToken);
    const userCache = new UserCache({ client });
    const userService = new UserService({
        cacheService: userCache,
        client: messageClient,
        documentService: documents,
    });

    const authenticationService = new AuthenticationService({
        cacheService: userCache,
        destinyService,
        userService,
    });
    const authenticationController = new AuthenticationController({ authenticationService });

    const world = new World({
        directory: process.env.DESTINY_DATABASE_DIR,
        pool,
    });
    const world2 = new World2({
        directory: process.env.DESTINY2_DATABASE_DIR,
        pool,
    });
    const destiny2Cache = new Destiny2Cache({ client });
    const destiny2Service = new Destiny2Service({ cacheService: destiny2Cache });
    const notificationService = new NotificationService({
        client: messageClient,
    });

    /**
     * Routes
     */
    const destinyRouter = DestinyRouter({
        authenticationController,
        destinyService,
        userService,
        worldRepository: world,
    });
    routes.use('/destiny', destinyRouter);

    const destiny2Controller = new Destiny2Controller({
        destinyService: destiny2Service,
        userService,
        worldRepository: world2,
    });
    const destiny2Router = Destiny2Router({
        authenticationController,
        destiny2Controller,
    });
    routes.use('/destiny2', destiny2Router);

    const healthRouter = HealthRouter({
        destinyService,
        destiny2Service,
        documents,
        worldRepository: world,
        world2Repository: world2,
    });
    routes.use('/health', healthRouter);

    const notificationRouter = NotificationRouter({
        authenticationService,
        destinyService: destiny2Service,
        notificationService,
        userService,
        worldRepository: world2,
    });
    routes.use('/notifications', notificationRouter);

    const twilioRouter = TwilioRouter({
        authenticationController,
        authenticationService,
        destinyService: destiny2Service,
        userService,
        worldRepository: world2,
    });
    routes.use('/twilio', twilioRouter);

    const userRouter = UserRouter({
        authenticationController,
        destinyService,
        notificationService,
        userService,
        worldRepository: world,
    });
    routes.use('/users', userRouter);

    const mcpRouter = McpRouter({
        destinyController: destiny2Controller,
    });
    routes.use('/mcp', mcpRouter);

    /**
     * GraphQL
     */
    const middleware = new AuthenticationMiddleWare({ authenticationController });

    routes.use(
        '/director',
        (req, res, next) => middleware.authenticateUser(req, res, next),
        createHandler({
            schema,
            rootValue: root,
            context: ({ raw: req }) => {
                const {
                    session: {
                        displayName,
                        membershipType,
                    },
                } = req;
                const isAdministrator = authenticationController.constructor.isAdministrator({
                    displayName,
                    membershipType,
                });

                return {
                    cacheService: destiny2Cache,
                    destiny2Service,
                    isAdministrator,
                    userService,
                };
            },
        }),
    );

    /**
     * Manifest Management
     * @type {Manifests}
     */
    const manifests = new Manifests({
        destinyService,
        destiny2Service,
        worldRepository: world,
        world2Repository: world2,
    });

    return { manifests, routes };
};
