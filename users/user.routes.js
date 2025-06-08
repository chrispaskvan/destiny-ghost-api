import { StatusCodes } from 'http-status-codes';
import cors from 'cors';
import { Router } from 'express';
import AuthenticationMiddleWare from '../authentication/authentication.middleware';
import UserController from './user.controller';
import configuration from '../helpers/config';
import log from '../helpers/log';

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
* @openapi
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
    const userController = new UserController({
        destinyService, notificationService, userService, worldRepository,
    });
    const userRouter = Router();

    userRouter.all('/', cors(configuration.cors));

    /**
     * @openapi
     * paths:
     *  /users/current:
     *    get:
     *      summary: Get the current Destiny Ghost user.
     *      tags:
     *        - Users
     *      security:
     *        - bungieOAuth: []
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
     *                type: string
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
     * @openapi
     * /users/current/ciphers:
     *   post:
     *     summary: Request a verification code for the current user.
     *     description: Requests the system to send a time-sensitive verification code to the currently authenticated user's specified contact method (email or phone). This code is used to verify ownership of the contact method before performing sensitive operations like profile edits. The user's email address or phone number associated with their Destiny Ghost profile will be used.
     *     tags:
     *       - Users
     *     security:
     *       - bungieOAuth: []
     *     requestBody:
     *       required: true
     *       content:
     *         application/json:
     *           schema:
     *             type: object
     *             required:
     *               - channel
     *             properties:
     *               channel:
     *                 type: string
     *                 enum:
     *                   - email
     *                   - phone
     *                 description: The communication channel to send the verification code to (must be registered with the user's profile).
     *             example:
     *               channel: email
     *     responses:
     *       202:
     *         description: Verification code successfully requested and is being sent. The user should check their email or phone.
     *       400:
     *         description: Bad Request. E.g., channel not specified, or user does not have the specified contact method registered and verified.
     *       401:
     *         description: Unauthorized. Bungie OAuth token missing or invalid.
     *       429:
     *         description: Too Many Requests. The user has requested codes too frequently.
     */
    userRouter.route('/current/ciphers')
        .post(
            (req, res, next) => middleware.authenticateUser(req, res, next),
            async (req, res) => {
                try {
                    const {
                        body: { channel },
                        session: { displayName, membershipType }
                    } = req;

                    if (!channel || !['email', 'phone'].includes(channel)) {
                        return res.status(StatusCodes.BAD_REQUEST).send('Invalid channel. Must be "email" or "phone".');
                    }

                    await userController.sendCipher({ 
                        displayName, 
                        membershipType, 
                        channel 
                    });

                    return res.status(StatusCodes.ACCEPTED).end();
                } catch (err) {
                    if (err.message.includes('not found')) {
                        return res.status(StatusCodes.BAD_REQUEST).send('User registration not found.');
                    }

                    throw err;
                }
            },
        );

    /**
     * @openapi
     * /users/current/cryptarch:
     *   post:
     *     summary: Validate a verification code for the current user.
     *     description: Validates the provided verification code for the currently authenticated user. This code is used to verify ownership of the contact method before performing sensitive operations like profile edits.
     *     tags:
     *       - Users
     *     security:
     *       - bungieOAuth: []
     *     requestBody:
     *       required: true
     *       content:
     *         application/json:
     *           schema:
     *             type: object
     *             required:
     *               - channel
     *               - code
     *             properties:
     *               channel:
     *                 type: string
     *                 enum:
     *                   - email
     *                   - phone
     *                 description: The communication channel to send the verification code to (must be registered with the user's profile).
     *               code:
     *                 type: string
     *                 description: The verification code received by the user.
     *                 example: 123456
     *     responses:
     *       204:
     *         description: Verification code successfully validated.
     *       400:
     *         description: Bad Request. E.g., channel not specified, or user does not have the specified contact method registered and verified.
     *       401:
     *         description: Unauthorized. Bungie OAuth token missing or invalid.
     *       404:
     *         description: Not Found. No pending verification found for this user and channel, or the code has already been used/invalidated.
     *       429:
     *         description: Too Many Requests. The user has requested codes too frequently.
     */
    userRouter.route('/current/cryptarch')
        .post(
            (req, res, next) => middleware.authenticateUser(req, res, next),
            async (req, res) => {
                try {
                    const {
                        body: { channel, code },
                        session: { displayName, membershipType }
                    } = req;

                    if (!channel || !['email', 'phone'].includes(channel)) {
                        return res.status(StatusCodes.BAD_REQUEST).send('Invalid channel. Must be "email" or "phone".');
                    }

                    await userController.decipher({ 
                        displayName, 
                        membershipType, 
                        channel, 
                        code 
                    });

                    return res.status(StatusCodes.NO_CONTENT).end();
                } catch {
                    return res.status(StatusCodes.NOT_FOUND).send('Invalid cipher.');
                }
            }
        );

    /**
     * @openapi
     * paths:
     *  /users/join:
     *    post:
     *      summary: Confirm the user.
     *      tags:
     *        - Users
     *      security:
     *        - bungieOAuth: []
     *      requestBody:
     *        required: true
     *        content:
     *          application/json:
     *            schema:
     *              type: object
     *              properties:
     *                tokens:
     *                  type: object
     *                  properties:
     *                    phoneNumber:
     *                      type: string
     *                      format: phone
     *                    emailAddress:
     *                      type: string
     *                      format: email
     *      responses:
     *        200:
     *          description: User joined successfully.
     *        400:
     *          description: Bad request.
     */
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

    /**
     * Intentionally excluded from the OpenAPI documentation. This route is used for signing in
     * with Bungie OAuth. It handles the OAuth callback and signs
     * in the user based on the provided code and state.
     */
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
                return res.sendStatus(StatusCodes.UNAUTHORIZED);
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
     * @openapi
     * paths:
     *  /users/signOut:
     *    post:
     *      summary: Sign out a user.
     *      tags:
     *        - Users
     *      security:
     *        - bungieOAuth: []
     *      responses:
     *        204:
     *          description: No Content
     *        500:
     *          description: Internal Server Error
     */
    userRouter.route('/signOut')
        .post((req, res, next) => middleware.authenticateUser(req, res, next),
            (req, res) => {
                req.session.destroy(err => {
                    if (err) {
                        return res.status(StatusCodes.INTERNAL_SERVER_ERROR)
                            .json({ error: 'Failed to sign out' });
                    }
                    res.status(StatusCodes.NO_CONTENT).end();
                });
            });

    /**
     * @openapi
     * paths:
     *  /users/signUp:
     *    post:
     *      summary: Sign up for the service.
     *      tags:
     *        - Users
     *      security:
     *        - bungieOAuth: []
     *      requestBody:
     *        required: true
     *        content:
     *          application/json:
     *            schema:
     *              type: object
     *              properties:
     *                firstName:
     *                  type: string
     *                lastName:
     *                  type: string
     *                phoneNumber:
     *                  type: string
     *                  format: phone
     *                emailAddress:
     *                  type: string
     *                  format: email
     *      description: Sign up for the service with a first name, last name, phone number, and email address.
     *      responses:
     *        204:
     *          description: No Content
     */
    userRouter.route('/signUp')
        .post((req, res, next) => middleware.authenticateUser(req, res, next),
            async (req, res) => {
                const { body: user, session: { displayName, membershipType } } = req;

                if (!(user.firstName && user.lastName && user.phoneNumber && user.emailAddress)) {
                    return res.status(StatusCodes.UNPROCESSABLE_ENTITY).end();
                }

                const newUser = await userController.signUp({ displayName, membershipType, user });

                log.info(user, newUser ? 'User signed up' : 'User sign up failed due to conflicts');

                return res.status(StatusCodes.NO_CONTENT).end();
            });

    /**
     * @openapi
     * paths:
     *  /users/{userId}:
     *    patch:
     *      summary: Update a user's profile.
     *      description: See [JSONPatch](https://jsonpatch.com) for more information.
     *      tags:
     *        - Users
     *      security:
     *        - bungieOAuth: []
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

    return userRouter;
};

export default routes;
