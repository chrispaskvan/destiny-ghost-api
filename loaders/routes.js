/**
 * Route Definitions
 */
const express = require('express');
const swaggerUi = require('swagger-ui-express');
const twilio = require('twilio');

const AuthenticationController = require('../authentication/authentication.controller');
const AuthenticationService = require('../authentication/authentication.service');
const Destiny2Cache = require('../destiny2/destiny2.cache');
const Destiny2Service = require('../destiny2/destiny2.service');
const DestinyCache = require('../destiny/destiny.cache');
const DestinyService = require('../destiny/destiny.service');
const DestinyTrackerService = require('../destinytracker/destinytracker.service');
const NotificationService = require('../notifications/notification.service');
const UserCache = require('../users/user.cache');
const UserService = require('../users/user.service');
const World = require('../helpers/world');
const World2 = require('../helpers/world2');
const documents = require('../helpers/documents');
const { twilio: { accountSid, authToken } } = require('../helpers/config');

const DestinyRouter = require('../destiny/destiny.routes');
const Destiny2Router = require('../destiny2/destiny2.routes');
const HealthRouter = require('../health/health.routes');
const Manifests = require('./manifests');
const NotificationRouter = require('../notifications/notification.routes');
const TwilioRouter = require('../twilio/twilio.routes');
const UserRouter = require('../users/user.routes');
const swaggerDocument = require('../swagger.json');

module.exports = () => {
    const routes = express.Router();

    /**
     * Swagger
     */
    routes.use('/docs', swaggerUi.serve);
    routes.get(
        '/docs',
        swaggerUi.setup(swaggerDocument, {
            explorer: false,
        }),
    );

    /**
     * Dependencies
     */
    const destinyCache = new DestinyCache();
    const destinyService = new DestinyService({
        cacheService: destinyCache,
    });

    const messageClient = twilio(accountSid, authToken);
    const userCache = new UserCache();
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
    const destiny2Cache = new Destiny2Cache();
    const destiny2Service = new Destiny2Service({ cacheService: destiny2Cache });
    const destinyTrackerService = new DestinyTrackerService();
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
        destinyTrackerService,
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
