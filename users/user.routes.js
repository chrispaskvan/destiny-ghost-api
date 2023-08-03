import { StatusCodes } from 'http-status-codes';
import cors from 'cors';
import { Router } from 'express';
import AuthenticationMiddleWare from '../authentication/authentication.middleware';
import RoleMiddleware from './role.middleware';
import UserController from './user.controller';

import configuration from '../helpers/config';

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

    return res.status(StatusCodes.OK)
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
    const userRouter = Router();

    userRouter.all('*', cors(configuration.cors));

    userRouter.route('/signUp')
        .post(
            (req, res, next) => middleware.authenticateUser(req, res, next),
            (req, res, next) => {
                const { body: user, session: { displayName, membershipType } } = req;

                if (!(user.firstName && user.lastName && user.phoneNumber && user.emailAddress)) {
                    return res.status(StatusCodes.UNPROCESSABLE_ENTITY).end();
                }

                return userController.signUp({ displayName, membershipType, user })
                    .then(newUser => (newUser
                        ? res.status(StatusCodes.OK).end()
                        : res.status(StatusCodes.CONFLICT).end()))
                    .catch(next);
            },
        );

    userRouter.route('/join')
        .post(
            (req, res, next) => middleware.authenticateUser(req, res, next),
            (req, res, next) => {
                const { body: user } = req;

                userController.join(user)
                    .then(newUser => (newUser
                        ? res.status(StatusCodes.OK).end()
                        : res.status(StatusCodes.BAD_REQUEST).end()))
                    .catch(next);
            },
        );

    userRouter.route('/signIn/Bungie')
        .get((req, res, next) => {
            const {
                query: { code, state: queryState },
                session: { displayName, state: sessionState },
            } = req;

            if (displayName) {
                return res.status(StatusCodes.OK)
                    .json({ displayName });
            }
            if (sessionState !== queryState) {
                return res.sendStatus(StatusCodes.FORBIDDEN);
            }

            return userController.signIn({
                code,
                displayName,
                queryState,
                sessionState,
            })
                .then(user => {
                    if (!user) {
                        return res.status(StatusCodes.NOT_FOUND).end();
                    }

                    return signIn(req, res, user);
                })
                .catch(next);
        });

    userRouter.route('/signOut')
        .get((req, res) => {
            req.session.destroy();
            res.status(StatusCodes.UNAUTHORIZED).end();
        });

    /**
     * @swagger
     * paths:
     *  /users/{emailAddress}/emailAddress:
     *    get:
     *      summary: Get the Destiny Ghost user by email address.
     *      tags:
     *        - Users
     *      parameters:
     *        - in: path
     *          name: emailAddress
     *          schema:
     *            type: string
     *          required: true
     *          description: The email address of the Destiny Ghost user.
     *      produces:
     *        - application/json
     *      responses:
     *        204:
     *          description: Destiny Ghost user found.
     *        404:
     *          description: No Destiny Ghost user found.
     */
    userRouter.route('/:emailAddress/emailAddress')
        .get(
            (req, res, next) => middleware.authenticateUser(req, res, next),
            (req, res, next) => {
                const { params: { emailAddress } } = req;

                return userController.getUserByEmailAddress(emailAddress)
                    .then(user => (user
                        ? res.status(StatusCodes.NO_CONTENT).end()
                        : res.status(StatusCodes.NOT_FOUND).end()))
                    .catch(next);
            },
        );

    /**
     * @swagger
     * paths:
     *  /users/{phoneNumber}/phoneNumber:
     *    get:
     *      summary: Get the Destiny Ghost user by phone number.
     *      tags:
     *        - Users
     *      parameters:
     *        - in: path
     *          name: phoneNumber
     *          schema:
     *            type: string
     *          required: true
     *          description: The phone number of the Destiny Ghost user.
     *      produces:
     *        - application/json
     *      responses:
     *        204:
     *          description: Destiny Ghost user found.
     *        404:
     *          description: No Destiny Ghost user found.
     */
    userRouter.route('/:phoneNumber/phoneNumber')
        .get(
            (req, res, next) => middleware.authenticateUser(req, res, next),
            (req, res, next) => {
                const { params: { phoneNumber } } = req;

                return userController.getUserByPhoneNumber(phoneNumber)
                    .then(user => (user
                        ? res.status(StatusCodes.NO_CONTENT).end()
                        : res.status(StatusCodes.NOT_FOUND).end()))
                    .catch(next);
            },
        );

    userRouter.route('/join')
        .post(
            (req, res, next) => middleware.authenticateUser(req, res, next),
            (req, res, next) => userController.join(req, res)
                .catch(next),
        );

    /**
     * @swagger
     * paths:
     *  /users/current:
     *    get:
     *      summary: Get the current Destiny Ghost user.
     *      tags:
     *        - Users
     *      produces:
     *        - application/json
     *      responses:
     *        200:
     *          description: Returns the current Destiny Ghost user's profile.
     *        401:
     *          description: Unauthorized
     *        404:
     *          description: Destiny Ghost profile for the current user was not found.
     */
    userRouter.route('/current')
        .get(
            (req, res, next) => middleware.authenticateUser(req, res, next),
            (req, res, next) => {
                const { session: { displayName, membershipType } } = req;

                if (!displayName || !membershipType) {
                    return res.status(StatusCodes.NOT_FOUND).end();
                }

                return userController.getCurrentUser(displayName, membershipType)
                    .then(user => {
                        if (user) {
                            return res.status(StatusCodes.OK).json(user);
                        }

                        return res.status(StatusCodes.UNAUTHORIZED).end();
                    })
                    .catch(next);
            },
        );

    userRouter.route('/')
        .patch(
            (req, res, next) => middleware.authenticateUser(req, res, next),
            (req, res, next) => {
                const { body: patches, session: { displayName, membershipType } } = req;
                userController.update({ displayName, membershipType, patches })
                    .then(user => (user
                        ? res.json(user)
                        : res.status(StatusCodes.NOT_FOUND).send('user not found')))
                    .catch(next);
            },
        );

    userRouter.route('/:id/version/:version')
        .get(
            (req, res, next) => middleware.authenticateUser(req, res, next),
            (req, res, next) => roles.administrativeUser(req, res, next),
            (req, res, next) => {
                const { params: { id, version } } = req;

                if (!id) {
                    return res.status(StatusCodes.CONFLICT).send('phone number not found');
                }

                return userController.getUserById(id, version)
                    .then(user => (user
                        ? res.status(StatusCodes.OK).json(user)
                        : res.status(StatusCodes.NOT_FOUND).send('user not found')))
                    .catch(next);
            },
        );

    return userRouter;
};

export default routes;
