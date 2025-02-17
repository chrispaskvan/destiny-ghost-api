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

/**
* @swagger
*  components:
*    schemas:
*      Patch:
*        type: array
*        items:
*          type: object
*          properties:
*            op:
*              type: string
*              enum: [replace]
*            path:
*              type: string
*            value:
*              type: string
*      User:
*        type: object
*        required:
*          - displayName
*        properties:
*          dateRegistered:
*            type: string
*            format: date-time
*          displayName:
*            type: string
*          emailAddress:
*            type: string
*            format: email
*          firstName:
*            type: string
*          lastName:
*            type: string
*          links:
*            type: array
*            items:
*              $ref: '#/components/schemas/Link'
*          notifications:
*            type: array
*            items:
*              $ref: '#/components/schemas/Notification'
*          phoneNumber:
*            type: string
*            format: phone
*          profilePicturePath:
*            type: string
*/
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
            async (req, res) => {
                const { body: user, session: { displayName, membershipType } } = req;

                if (!(user.firstName && user.lastName && user.phoneNumber && user.emailAddress)) {
                    return res.status(StatusCodes.UNPROCESSABLE_ENTITY).end();
                }

                const newUser = await userController.signUp({ displayName, membershipType, user });

                return newUser
                    ? res.status(StatusCodes.OK).end()
                    : res.status(StatusCodes.CONFLICT).end();
            });

    userRouter.route('/join')
        .post(
            (req, res, next) => middleware.authenticateUser(req, res, next),
            async (req, res) => {
                const { body: user } = req;

                const newUser = await userController.join(user);
                return newUser
                    ? res.status(StatusCodes.OK).end()
                    : res.status(StatusCodes.BAD_REQUEST).end();
            },
        );

    userRouter.route('/signIn/Bungie')
        .get(async (req, res, next) => {
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
        });

    /**
     * @swagger
     * paths:
     *  /users/signOut:
     *    post:
     *      summary: Sign out a user.
     *      tags:
     *        - Users
     *      responses:
     *        200:
     *          description: Success
     *        500:
     *          description: Internal Server Error
     */
    userRouter.route('/signOut')
        .post((req, res) => {
            req.session.destroy(err => {
                if (err) {
                    return res.status(StatusCodes.INTERNAL_SERVER_ERROR)
                        .json({ error: 'Failed to sign out' });
                }
                res.status(StatusCodes.OK).end();
            });
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
            async (req, res) => {
                const { params: { emailAddress } } = req;
                const user = await userController.getUserByEmailAddress(emailAddress);

                return user
                    ? res.status(StatusCodes.NO_CONTENT).end()
                    : res.status(StatusCodes.NOT_FOUND).end();
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
            async (req, res) => {
                const { params: { phoneNumber } } = req;

                const user = await userController.getUserByPhoneNumber(phoneNumber);
                return user
                    ? res.status(StatusCodes.NO_CONTENT).end()
                    : res.status(StatusCodes.NOT_FOUND).end();
            },
        );

    userRouter.route('/join')
        .post((req, res, next) => middleware.authenticateUser(req, res, next),
            (req, res) => userController.join(req, res),
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
     *          content:
     *            application/json:
     *              schema:
     *                $ref: '#/components/schemas/User'
     *          headers:
     *            'ETag':
     *              description: The ETag of the updated user profile.
     *              schema:
     *              type: string
     *        401:
     *          description: Unauthorized
     *        404:
     *          description: Destiny Ghost profile for the current user was not found.
     */
    userRouter.route('/current')
        .get(async (req, res, next) => await middleware.authenticateUser(req, res, next),
            async (req, res) => {
                const { session: { displayName, membershipType } } = req;

                if (!displayName || !membershipType) {
                    return res.status(StatusCodes.NOT_FOUND).end();
                }

                const { ETag, user } = await userController.getCurrentUser(displayName, membershipType);

                if (user) {
                    return res.setHeader('ETag', ETag).status(StatusCodes.OK).json(user);
                }

                return res.status(StatusCodes.UNAUTHORIZED).end();
            },
        );
    /**
     * @swagger
     * paths:
     *  /users/{userId}:
     *    patch:
     *      summary: Update a user's profile.
     *      description: See [JSONPatch](https://jsonpatch.com) for more information.
     *      tags:
     *        - Users
     *      parameters:
     *        - name: If-Match
     *          in: header
     *          description: The ETag of the user profile.
     *          schema:
     *            type: string
     *          required: true
     *        - name: userId
     *          in: path
     *          description: The user's id.
     *          required: true
     *          schema:
     *            type: string
     *      requestBody:
     *        description: Update an existent user in the store
     *        content:
     *          application/json:
     *            schema:
     *              $ref: '#/components/schemas/Patch'
     *      produces:
     *        - application/json
     *      responses:
     *        204:
     *          description: Returns the updated user profile.
     */
    userRouter.route('/')
        .patch(
            (req, res, next) => middleware.authenticateUser(req, res, next),
            async (req, res) => {
                try {
                    const {
                        body: patches,
                        headers: {
                            'if-match': ETag
                        },
                        session: {
                            displayName,
                            membershipType
                        }
                    } = req;

                    if (!ETag) {
                        return res.status(StatusCodes.PRECONDITION_REQUIRED).end();
                    }

                    const user = await userController.update({ ETag, displayName, membershipType, patches });

                    return user
                        ? res.status(StatusCodes.NO_CONTENT).end()
                        : res.status(StatusCodes.NOT_FOUND).send('user not found');
                } catch (err) {
                    if (err.message === 'precondition failed') {
                        return res.status(StatusCodes.PRECONDITION_FAILED).end();
                    }

                    throw err;
                }
            },
        );

    userRouter.route('/:id/version/:version')
        .get((req, res, next) => middleware.authenticateUser(req, res, next),
            (req, res, next) => roles.administrativeUser(req, res, next),
            async (req, res) => {
                const { params: { id, version } } = req;

                if (!id) {
                    return res.status(StatusCodes.CONFLICT).send('user id not found');
                }

                const user = await userController.getUserById(id, version);
                return user
                    ? res.status(StatusCodes.OK).json(user)
                    : res.status(StatusCodes.NOT_FOUND).send('user not found');
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
     *      parameters:
     *        - name: phoneNumber
     *          in: path
     *          description: The phone number of the user.
     *          required: true
     *          schema:
     *            type: string
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
            async (req, res) => {
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
            },
        );

    return userRouter;
};

export default routes;
