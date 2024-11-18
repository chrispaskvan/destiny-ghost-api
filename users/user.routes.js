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
function signIn(req, res, user, next) {
    req.session.regenerate(err => {
        if (err) next(err);

        req.session.displayName = user.displayName;
        req.session.membershipType = user.membershipType;
        req.session.state = undefined;

        res.status(StatusCodes.OK)
            .json({ displayName: user.displayName });
    });
}

/**
 * Validate the given phone number
 * @param {*} phoneNumber
 * @returns boolean
 */
function isPhoneNumber(phoneNumber) {
    return !!phoneNumber.trim().length;
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

    userRouter.all('/', cors(configuration.cors));

    userRouter.route('/signUp')
        .post((req, res, next) => middleware.authenticateUser(req, res, next),
            async (req, res, next) => {
                try {    
                    const { body: user, session: { displayName, membershipType } } = req;

                    if (!(user.firstName && user.lastName && user.phoneNumber && user.emailAddress)) {
                        return res.status(StatusCodes.UNPROCESSABLE_ENTITY).end();
                    }

                    const newUser = await userController.signUp({ displayName, membershipType, user });

                    return newUser
                        ? res.status(StatusCodes.OK).end()
                        : res.status(StatusCodes.CONFLICT).end();
                } catch (err) {
                    next(err);
                }
            });

    userRouter.route('/join')
        .post(
            (req, res, next) => middleware.authenticateUser(req, res, next),
            async (req, res, next) => {
                try {
                    const { body: user } = req;

                    const newUser = await userController.join(user)
                    return newUser
                        ? res.status(StatusCodes.OK).end()
                        : res.status(StatusCodes.BAD_REQUEST).end();
                } catch (err) {
                    next(err);
                }
            },
        );

    userRouter.route('/signIn/Bungie')
        .get(async (req, res, next) => {
            try {
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

                const user = await userController.signIn({
                    code,
                    displayName,
                    queryState,
                    sessionState,
                });
                if (!user) {
                    return res.status(StatusCodes.NOT_FOUND).end();
                }

                return signIn(req, res, user, next);
            } catch (err) {
                next(err);
            }
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
        .get((req, res, next) => middleware.authenticateUser(req, res, next),
            async (req, res, next) => {
                try {
                    const { params: { emailAddress } } = req;
                    const user = await userController.getUserByEmailAddress(emailAddress);

                    return user
                        ? res.status(StatusCodes.NO_CONTENT).end()
                        : res.status(StatusCodes.NOT_FOUND).end();
                } catch (err) {
                    next(err);
                }
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
        .get((req, res, next) => middleware.authenticateUser(req, res, next),
            async (req, res, next) => {
                try {
                    const { params: { phoneNumber } } = req;

                    const user = await userController.getUserByPhoneNumber(phoneNumber);
                    return user
                        ? res.status(StatusCodes.NO_CONTENT).end()
                        : res.status(StatusCodes.NOT_FOUND).end();
                } catch (err) {
                    next(err);
                }
            },
        );

    userRouter.route('/join')
        .post((req, res, next) => middleware.authenticateUser(req, res, next),
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
        .get(async (req, res, next) => await middleware.authenticateUser(req, res, next),
            async (req, res, next) => {
                try {
                    const { session: { displayName, membershipType } } = req;

                    if (!displayName || !membershipType) {
                        return res.status(StatusCodes.NOT_FOUND).end();
                    }

                    const user = await userController.getCurrentUser(displayName, membershipType);
                    if (user) {
                        return res.status(StatusCodes.OK).json(user);
                    }

                    return res.status(StatusCodes.UNAUTHORIZED).end();
                } catch (err) {
                    next(err);
                }
            },
        );

    userRouter.route('/')
        .patch(
            (req, res, next) => middleware.authenticateUser(req, res, next),
            async (req, res, next) => {
                try {
                    const { body: patches, session: { displayName, membershipType } } = req;
                    const user = await userController.update({ displayName, membershipType, patches });

                    return user
                        ? res.json(user)
                        : res.status(StatusCodes.NOT_FOUND).send('user not found');
                } catch (err) {
                    next(err);
                }
            },
        );

    userRouter.route('/:id/version/:version')
        .get((req, res, next) => middleware.authenticateUser(req, res, next),
            (req, res, next) => roles.administrativeUser(req, res, next),
            async (req, res, next) => {
                try {
                    const { params: { id, version } } = req;

                    if (!id) {
                        return res.status(StatusCodes.CONFLICT).send('user id not found');
                    }

                    const user = await userController.getUserById(id, version);
                    return user
                        ? res.status(StatusCodes.OK).json(user)
                        : res.status(StatusCodes.NOT_FOUND).send('user not found');
                } catch (err) {
                    next(err);
                }
            },
        );

    /**
     * @swagger
     * paths:
     *  /users/{phoneNumber}/phoneNumber/messages:
     *    delete:
     *      summary: Delete intermediary messages for a given user.
     *      tags:
     *        - Users
     *      produces:
     *        - application/json
     *      responses:
     *        200:
     *          description: Success
     *        401:
     *          description: Unauthorized
     *        404:
     *          description: User was not found.
     *        409:
     *          description: Phone Number not given.
     */
    userRouter.route('/:phoneNumber/phoneNumber/messages')
        .delete(
            (req, res, next) => middleware.authenticateUser(req, res, next),
            (req, res, next) => roles.administrativeUser(req, res, next),
            async (req, res, next) => {
                try {
                    const { params: { phoneNumber } } = req;

                    if (!isPhoneNumber(phoneNumber)) {
                        return res.status(StatusCodes.CONFLICT).send('phone number not found');
                    }

                    const user = await userController.getUserByPhoneNumber(phoneNumber);

                    if (!user) {
                        return res.status(StatusCodes.NOT_FOUND).send('user not found');
                    }

                    await userController.deleteUserMessages(user);

                    return res.status(StatusCodes.OK).end();
                } catch (err) {
                    return next(err);
                }
            },
        );

    return userRouter;
};

export default routes;
