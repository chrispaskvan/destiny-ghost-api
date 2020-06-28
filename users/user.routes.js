const HttpStatus = require('http-status-codes');
const cors = require('cors');
const express = require('express');
const AuthenticationMiddleWare = require('../authentication/authentication.middleware');
const RoleMiddleware = require('./role.middleware');
const UserController = require('./user.controller');

const { cors: corsConfig } = require('../helpers/config');

/**
 * Sign the user in by setting the session.
 *
 * @param req
 * @param res
 * @param user
 * @private
 */
function signIn(req, res, user) {
    req.session.displayName = user.displayName;
    req.session.membershipType = user.membershipType;
    req.session.state = undefined;

    return res.status(HttpStatus.OK)
        .json({ displayName: user.displayName });
}

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
            (req, res, next) => {
                const { body: user, session: { displayName, membershipType } } = req;

                if (!(user.firstName && user.lastName && user.phoneNumber && user.emailAddress)) {
                    return res.status(HttpStatus.UNPROCESSABLE_ENTITY).end();
                }

                return userController.signUp({ displayName, membershipType, user })
                    .then(newUser => (newUser
                        ? res.status(HttpStatus.OK).end()
                        : res.status(HttpStatus.CONFLICT).end()))
                    .catch(next);
            });

    userRouter.route('/join')
        .post((req, res, next) => middleware.authenticateUser(req, res, next),
            (req, res, next) => {
                const { body: user } = req;

                userController.join(user)
                    .then(newUser => (newUser
                        ? res.status(HttpStatus.OK).end()
                        : res.status(HttpStatus.BAD_REQUEST).end()))
                    .catch(next);
            });

    userRouter.route('/signIn/Bungie')
        .get((req, res, next) => {
            const {
                query: { code, state: queryState },
                session: { displayName, state: sessionState },
            } = req;

            if (displayName) {
                return res.status(HttpStatus.OK)
                    .json({ displayName });
            }
            if (sessionState !== queryState) {
                return res.sendStatus(HttpStatus.FORBIDDEN);
            }

            return userController.signIn({
                code,
                displayName,
                queryState,
                sessionState,
            })
                .then(user => {
                    if (!user) {
                        return res.status(HttpStatus.NOT_FOUND).end();
                    }

                    return signIn(req, res, user);
                })
                .catch(next);
        });

    userRouter.route('/signOut')
        .get((req, res) => {
            req.session.destroy();
            res.status(HttpStatus.UNAUTHORIZED).end();
        });

    userRouter.route('/:emailAddress/emailAddress')
        .get((req, res, next) => middleware.authenticateUser(req, res, next),
            (req, res, next) => {
                const { params: { emailAddress } } = req;

                return userController.getUserByEmailAddress(emailAddress)
                    .then(user => (user
                        ? res.status(HttpStatus.NO_CONTENT).end()
                        : res.status(HttpStatus.NOT_FOUND).end()))
                    .catch(next);
            });

    userRouter.route('/:phoneNumber/phoneNumber')
        .get((req, res, next) => middleware.authenticateUser(req, res, next),
            (req, res, next) => {
                const { params: { phoneNumber } } = req;

                return userController.getUserByPhoneNumber(phoneNumber)
                    .then(user => (user
                        ? res.status(HttpStatus.NO_CONTENT).end()
                        : res.status(HttpStatus.NOT_FOUND).end()))
                    .catch(next);
            });

    userRouter.route('/join')
        .post((req, res, next) => middleware.authenticateUser(req, res, next),
            (req, res, next) => userController.join(req, res)
                .catch(next));

    userRouter.route('/current')
        .get((req, res, next) => middleware.authenticateUser(req, res, next),
            (req, res, next) => {
                const { session: { displayName, membershipType } } = req;

                if (!displayName || !membershipType) {
                    return res.status(HttpStatus.NOT_FOUND).end();
                }

                return userController.getCurrentUser(displayName, membershipType)
                    .then(user => {
                        if (user) {
                            return res.status(HttpStatus.OK).json(user);
                        }

                        return res.status(HttpStatus.UNAUTHORIZED).end();
                    })
                    .catch(next);
            });

    userRouter.route('/')
        .patch((req, res, next) => middleware.authenticateUser(req, res, next),
            (req, res, next) => {
                const { body: patches, session: { displayName, membershipType } } = req;
                userController.update({ displayName, membershipType, patches })
                    .then(user => (user
                        ? res.json(user)
                        : res.status(HttpStatus.NOT_FOUND).send('user not found')))
                    .catch(next);
            });

    userRouter.route('/:id/version/:version')
        .get((req, res, next) => middleware.authenticateUser(req, res, next),
            (req, res, next) => roles.administrativeUser(req, res, next),
            (req, res, next) => {
                const { params: { id, version } } = req;

                if (!id) {
                    return res.status(HttpStatus.CONFLICT).send('phone number not found');
                }

                return userController.getUserById(id, version)
                    .then(user => (user
                        ? res.status(HttpStatus.OK).json(user)
                        : res.status(HttpStatus.NOT_FOUND).send('user not found')))
                    .catch(next);
            });

    return userRouter;
};

module.exports = routes;
