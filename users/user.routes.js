const cors = require('cors');
const express = require('express');
const AuthenticationMiddleWare = require('../authentication/authentication.middleware');
const RoleMiddleware = require('./role.middleware');
const UserController = require('./user.controller');

const corsConfig = require(`../settings/cors.${process.env.NODE_ENV}.json`); // eslint-disable-line import/no-dynamic-require

const routes = ({
    authenticationController, destinyService, notificationService, userService, worldRepository,
}) => {
    const middleware = new AuthenticationMiddleWare({ authenticationController });
    const roles = new RoleMiddleware({ authenticationController });
    const userController = new UserController({
        destinyService, notificationService, userService, worldRepository,
    });
    const userRouter = express.Router();

    userRouter.all('*', cors(corsConfig));

    userRouter.route('/signUp')
        .post((req, res, next) => middleware.authenticateUser(req, res, next),
            (req, res, next) => userController.signUp(req, res)
                .catch(next));

    userRouter.route('/join')
        .post((req, res, next) => middleware.authenticateUser(req, res, next),
            (req, res, next) => userController.join(req, res)
                .catch(next));

    userRouter.route('/signIn/Bungie')
        .get((req, res, next) => userController.signIn(req, res)
            .catch(next));

    userRouter.route('/signOut')
        .get((req, res, next) => UserController.signOut(req, res)
            .catch(next));

    userRouter.route('/:emailAddress/emailAddress')
        .get((req, res, next) => middleware.authenticateUser(req, res, next),
            (req, res, next) => userController.getUserByEmailAddress(req, res)
                .catch(next));

    userRouter.route('/:phoneNumber/phoneNumber')
        .get((req, res, next) => middleware.authenticateUser(req, res, next),
            (req, res, next) => userController.getUserByPhoneNumber(req, res)
                .catch(next));

    userRouter.route('/join')
        .post((req, res, next) => middleware.authenticateUser(req, res, next),
            (req, res, next) => userController.join(req, res)
                .catch(next));

    userRouter.route('/current')
        .get((req, res, next) => middleware.authenticateUser(req, res, next),
            (req, res, next) => userController.getCurrentUser(req, res)
                .catch(next));

    userRouter.route('/')
        .patch((req, res, next) => middleware.authenticateUser(req, res, next),
            (req, res, next) => userController.update(req, res)
                .catch(next));

    userRouter.route('/:id/version/:version')
        .get((req, res, next) => middleware.authenticateUser(req, res, next),
            (req, res, next) => roles.administrativeUser(req, res, next),
            (req, res, next) => userController.getUserById(req, res)
                .catch(next));

    return userRouter;
};

module.exports = routes;
