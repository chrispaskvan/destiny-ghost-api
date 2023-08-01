/**
 * Route Definitions
 */
import { CosmosClient } from '@azure/cosmos';
import { Router } from 'express';
import { readFileSync } from 'fs';
import { serve, setup } from 'swagger-ui-express';
import twilio from 'twilio';

import AuthenticationController from '../authentication/authentication.controller';
import AuthenticationService from '../authentication/authentication.service';
import Destiny2Cache from '../destiny2/destiny2.cache';
import Destiny2Service from '../destiny2/destiny2.service';
import DestinyCache from '../destiny/destiny.cache';
import DestinyService from '../destiny/destiny.service';
import NotificationService from '../notifications/notification.service';
import UserCache from '../users/user.cache';
import UserService from '../users/user.service';
import World from '../helpers/world';
import World2 from '../helpers/world2';
import client from '../helpers/cache';
import Documents from '../helpers/documents';
import configuration from '../helpers/config';
import DestinyRouter from '../destiny/destiny.routes';
import Destiny2Router from '../destiny2/destiny2.routes';
import HealthRouter from '../health/health.routes';
import Manifests from './manifests';
import NotificationRouter from '../notifications/notification.routes';
import TwilioRouter from '../twilio/twilio.routes';
import UserRouter from '../users/user.routes';

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
        setup(JSON.parse(readFileSync('./swagger.json')), {
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
    });
    const world2 = new World2({
        directory: process.env.DESTINY2_DATABASE_DIR,
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

    const destiny2Router = Destiny2Router({
        authenticationController,
        destiny2Service,
        userService,
        worldRepository: world2,
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
        worldRepository: world2,
    });
    routes.use('/users', userRouter);

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
