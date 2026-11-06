// @ts-check
import { StatusCodes } from 'http-status-codes';
import { Router } from 'express';
import { z } from 'zod';
import AuthenticationMiddleWare from '../authentication/authentication.middleware.js';
import UserController from './user.controller.js';
import CipherAttemptsExceededError from './cipher-attempts-exceeded.error.js';
import InvalidCipherError from './invalid-cipher.error.js';
import InvalidPhoneNumberError from './invalid-phone-number.error.js';
import cleanPhoneNumber from './clean-phone-number.js';
import csrfProtection, { generateToken } from '../helpers/csrf.middleware.js';
import log from '../helpers/log.js';

/** @typedef {import('./user.controller.js').MutableUser} MutableUser */

/**
 * Custom fields this app stores on the session. `@types/express-session`'s
 * `SessionData` is empty by default and meant to be augmented via a `.d.ts`
 * `declare module` block; this project has no TypeScript source files, so
 * instead `req.session` is cast to this type at each access site.
 * @typedef {Object} AppSessionData
 * @property {string} [displayName]
 * @property {number} [membershipType]
 * @property {string} [state]
 * @property {string} [membershipId]
 * @property {string} [dateRegistered]
 */

/** @typedef {import('express-session').Session & AppSessionData} AppSession */

/**
 * The session shape once `authenticateUser` middleware has confirmed the
 * request is authenticated — displayName/membershipType are guaranteed set
 * by the sign-in flow that establishes the session in the first place.
 * @typedef {Object} AuthenticatedSessionData
 * @property {string} displayName
 * @property {number} membershipType
 */

/**
 * Sign the user in by setting the session.
 *
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 * @param {MutableUser} user
 * @param {import('express').NextFunction} next
 * @private
 */
function signIn(req, res, user, next) {
    req.session.regenerate(err => {
        if (err) return next(err);

        const session = /** @type {AppSession} */ (req.session);

        session.displayName = user.displayName;
        session.membershipType = user.membershipType;
        session.state = undefined;

        if (req.accepts(['json', 'html']) === 'html') {
            res.redirect(`${process.env.WEBSITE}/?auth=success`);
        } else {
            res.status(StatusCodes.OK).json({ displayName: user.displayName });
        }
    });
}

/**
 * @openapi
 *  components:
 *    parameters:
 *      CsrfToken:
 *        name: x-csrf-token
 *        in: header
 *        description: CSRF token obtained from `GET /users/current/csrfToken`. Required on state-changing requests to `/users`.
 *        required: true
 *        schema:
 *          type: string
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
 *              oneOf:
 *                - type: string
 *                - type: boolean
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

/** @typedef {import('../authentication/authentication.controller.js').default} AuthenticationController */

/**
 * @typedef {import('express').RequestHandler} RequestHandler
 */

/**
 * @typedef {Object} UserRoutesOptions
 * @property {(key: string) => Promise<boolean>} allowCipherAttempt - see `UserController`
 * @property {AuthenticationController} authenticationController
 * @property {import('../destiny/destiny.service.js').default} destinyService
 * @property {import('../notifications/notification.service.js').default} notificationService
 * @property {{ signUp: RequestHandler, resend: RequestHandler, cipher: RequestHandler }} rateLimiters
 * - per-account limits on the endpoints that send billed messages
 * @property {number} [tokenTtlSeconds] - see `UserController`
 * @property {import('./user.service.js').default} userService
 * @property {import('../helpers/world2.js').default} worldRepository
 */

/**
 * @param {UserRoutesOptions} options
 */
const routes = ({
    allowCipherAttempt,
    authenticationController,
    destinyService,
    notificationService,
    rateLimiters,
    tokenTtlSeconds,
    userService,
    worldRepository,
}) => {
    const middleware = new AuthenticationMiddleWare({ authenticationController });
    const userController = new UserController({
        allowCipherAttempt,
        destinyService,
        notificationService,
        tokenTtlSeconds,
        userService,
        worldRepository,
    });
    const userRouter = Router();

    /**
     * Ahead of the per-channel limits, so a malformed request neither spends
     * one nor gets a bucket of its own.
     * @type {import('express').RequestHandler}
     */
    const requireChannel = (req, res, next) => {
        const { channel } = req.body ?? {};

        if (!['email', 'phone'].includes(channel)) {
            return res
                .status(StatusCodes.BAD_REQUEST)
                .send('Invalid channel. Must be "email" or "phone".');
        }

        return next();
    };

    /**
     * The only four fields a client may supply when signing up.
     *
     * `.strict()` rather than the default strip: every other field on a user
     * document is the server's to set, and several are load-bearing. A
     * `notifications` array with `enabled: true` would put the supplied phone
     * number into the next broadcast without either proof of ownership being
     * checked, and `dateRegistered` - the sole marker separating a pending
     * account from a registered one - would make the conflict check treat the
     * record as claimed, silently blocking whoever actually owns the address.
     * `join()` is where both are assigned, once the emailed blob and the SMS
     * code have been validated.
     */
    const signUpSchema = z
        .object({
            firstName: z.string().min(1),
            lastName: z.string().min(1),
            phoneNumber: z.string().min(1),
            emailAddress: z.string().email(),
        })
        .strict();

    /**
     * @openapi
     * paths:
     *  /users/current:
     *    get:
     *      summary: Get the current Destiny Ghost user.
     *      operationId: getCurrentUser
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
    userRouter.route('/current').get(
        async (req, res, next) => await middleware.authenticateUser(req, res, next),
        async (req, res) => {
            const { displayName, membershipType } = /** @type {AppSessionData} */ (req.session);

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
     *     operationId: requestVerificationCode
     *     description: Sends a time-sensitive verification code to the user's registered email or phone. This code is required to verify ownership of the contact method before performing sensitive operations like profile edits.
     *     tags:
     *       - Users
     *     security:
     *       - bungieOAuth: []
     *     parameters:
     *       - $ref: '#/components/parameters/CsrfToken'
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
     *             examples:
     *               - channel: email
     *     responses:
     *       202:
     *         description: Verification code successfully requested and is being sent. The user should check their email or phone.
     *       400:
     *         description: Bad Request. E.g., channel not specified, or user does not have the specified contact method registered and verified.
     *       401:
     *         description: Unauthorized. Bungie OAuth token missing or invalid.
     *       403:
     *         description: Forbidden. Missing or invalid CSRF token.
     *       429:
     *         description: Too Many Requests. Three codes per channel every 15 minutes.
     */
    userRouter.route('/current/ciphers').post(
        (req, res, next) => middleware.authenticateUser(req, res, next),
        csrfProtection,
        requireChannel,
        rateLimiters.cipher,
        async (req, res) => {
            try {
                const {
                    body: { channel },
                } = req;
                const { displayName, membershipType } = /** @type {AuthenticatedSessionData} */ (
                    /** @type {unknown} */ (req.session)
                );

                await userController.sendCipher({
                    displayName,
                    membershipType,
                    channel,
                });

                return res.status(StatusCodes.ACCEPTED).end();
            } catch (err) {
                /**
                 * Exact: a provider error can say "not found" too (Twilio
                 * 20404), and it is not the user's missing registration.
                 */
                if (err instanceof Error && err.message === 'registration not found') {
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
     *     operationId: validateVerificationCode
     *     description: Validates the provided verification code for the currently authenticated user. This code is used to verify ownership of the contact method before performing sensitive operations like profile edits.
     *     tags:
     *       - Users
     *     security:
     *       - bungieOAuth: []
     *     parameters:
     *       - $ref: '#/components/parameters/CsrfToken'
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
     *                 examples: [123456]
     *     responses:
     *       204:
     *         description: Verification code successfully validated.
     *       400:
     *         description: Bad Request. E.g., channel not specified, or user does not have the specified contact method registered and verified.
     *       401:
     *         description: Unauthorized. Bungie OAuth token missing or invalid.
     *       403:
     *         description: Forbidden. Missing or invalid CSRF token.
     *       404:
     *         description: Not Found. No pending verification found for this user and channel, or the code has already been used/invalidated.
     *       429:
     *         description: >
     *           Too Many Requests. This code has had its five attempts, right or wrong, and
     *           no longer works. Request a new code.
     */
    userRouter.route('/current/cryptarch').post(
        (req, res, next) => middleware.authenticateUser(req, res, next),
        csrfProtection,
        requireChannel,
        async (req, res) => {
            try {
                const {
                    body: { channel, code },
                } = req;
                const { displayName, membershipType } = /** @type {AuthenticatedSessionData} */ (
                    /** @type {unknown} */ (req.session)
                );

                await userController.decipher({
                    displayName,
                    membershipType,
                    channel,
                    code,
                });

                return res.status(StatusCodes.NO_CONTENT).end();
            } catch (err) {
                if (err instanceof InvalidCipherError) {
                    return res.status(StatusCodes.NOT_FOUND).send('Invalid cipher.');
                }
                /**
                 * No Retry-After: waiting doesn't help. The code is spent,
                 * and only a new one can be checked.
                 */
                if (err instanceof CipherAttemptsExceededError) {
                    return res
                        .status(StatusCodes.TOO_MANY_REQUESTS)
                        .send('Too many attempts. Request a new code.');
                }

                throw err;
            }
        },
    );

    /**
     * @openapi
     * /users/current/csrfToken:
     *   get:
     *     summary: Get a CSRF token for the current session.
     *     operationId: getCsrfToken
     *     description: Mints (or returns the existing) CSRF token for the authenticated session. The frontend must send this token back via the `x-csrf-token` header on subsequent state-changing requests (`POST`/`PATCH`) to `/users`.
     *     tags:
     *       - Users
     *     security:
     *       - bungieOAuth: []
     *     responses:
     *       200:
     *         description: Returns a CSRF token scoped to the current session.
     *         headers:
     *           'Cache-Control':
     *             description: Always `no-store`, since this response carries a security token.
     *             schema:
     *               type: string
     *         content:
     *           application/json:
     *             schema:
     *               type: object
     *               properties:
     *                 csrfToken:
     *                   type: string
     *       401:
     *         description: Unauthorized. Bungie OAuth token missing or invalid.
     */
    userRouter.route('/current/csrfToken').get(
        (req, res, next) => middleware.authenticateUser(req, res, next),
        (req, res) => {
            res.set('Cache-Control', 'no-store')
                .status(StatusCodes.OK)
                .json({ csrfToken: generateToken(req) });
        },
    );

    /**
     * @openapi
     * paths:
     *  /users/join:
     *    post:
     *      summary: Confirm the user.
     *      operationId: join
     *      tags:
     *        - Users
     *      security:
     *        - bungieOAuth: []
     *      parameters:
     *        - $ref: '#/components/parameters/CsrfToken'
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
     *        403:
     *          description: Forbidden. Missing or invalid CSRF token.
     */
    userRouter.route('/join').post(
        (req, res, next) => middleware.authenticateUser(req, res, next),
        csrfProtection,
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
    userRouter.route('/signIn/Bungie').get(async (req, res, next) => {
        const {
            query: { code, state: queryState },
        } = req;
        const { displayName, state: sessionState } = /** @type {AppSessionData} */ (req.session);
        const wantsHtml = req.accepts(['json', 'html']) === 'html';

        if (displayName) {
            if (wantsHtml) {
                return res.redirect(`${process.env.WEBSITE}/?auth=success`);
            }

            return res.status(StatusCodes.OK).json({ displayName });
        }
        if (!sessionState || sessionState !== queryState || typeof code !== 'string' || !code) {
            if (wantsHtml) {
                return res.redirect(`${process.env.WEBSITE}/?error=unauthorized`);
            }

            return res.sendStatus(StatusCodes.UNAUTHORIZED);
        }

        const user = await userController.signIn({
            code,
            displayName,
        });
        if (!user) {
            if (wantsHtml) {
                return res.redirect(`${process.env.WEBSITE}/?error=auth_failed`);
            }

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
     *      operationId: signOut
     *      tags:
     *        - Users
     *      security:
     *        - bungieOAuth: []
     *      parameters:
     *        - $ref: '#/components/parameters/CsrfToken'
     *      responses:
     *        204:
     *          description: No Content
     *        403:
     *          description: Forbidden. Missing or invalid CSRF token.
     *        500:
     *          description: Internal Server Error
     */
    userRouter.route('/signOut').post(
        (req, res, next) => middleware.authenticateUser(req, res, next),
        csrfProtection,
        (req, res) => {
            req.session.destroy(err => {
                if (err) {
                    return res
                        .status(StatusCodes.INTERNAL_SERVER_ERROR)
                        .json({ error: 'Failed to sign out' });
                }
                res.status(StatusCodes.NO_CONTENT).end();
            });
        },
    );

    /**
     * @openapi
     * paths:
     *  /users/signUp:
     *    post:
     *      summary: Sign up for the service.
     *      operationId: signUp
     *      tags:
     *        - Users
     *      security:
     *        - bungieOAuth: []
     *      parameters:
     *        - $ref: '#/components/parameters/CsrfToken'
     *      requestBody:
     *        required: true
     *        content:
     *          application/json:
     *            schema:
     *              type: object
     *              additionalProperties: false
     *              required:
     *                - firstName
     *                - lastName
     *                - phoneNumber
     *                - emailAddress
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
     *      description: >
     *        Sign up for the service with a first name, last name, phone number, and email
     *        address. These are the only accepted fields; every other property of an account
     *        is server-owned and assigned during verification, so a request carrying one is
     *        rejected rather than ignored.
     *      responses:
     *        204:
     *          description: >
     *            No Content. Returned whether or not this account, address or number was
     *            already registered, and whether or not the verification messages could be
     *            sent, so a conflict is not disclosed. A registered account can't change its
     *            contact by signing up; it is sent nothing. Signing up again sends new codes
     *            on both channels and replaces the earlier ones.
     *        403:
     *          description: Forbidden. Missing or invalid CSRF token.
     *        422:
     *          description: >
     *            Unprocessable Entity. A field is missing, malformed, unexpected, or the phone
     *            number cannot be used.
     *        429:
     *          description: Too Many Requests. Five sign-ups an hour per account.
     */
    userRouter.route('/signUp').post(
        (req, res, next) => middleware.authenticateUser(req, res, next),
        csrfProtection,
        /**
         * The request is checked whole - fields, then the phone number -
         * ahead of the sign-up limit, so a typo neither sends anything nor
         * spends one of the hour's sign-ups. Nothing here depends on whether
         * the address or number is registered, so a 422 reveals nothing.
         */
        (req, res, next) => {
            /**
             * Everything else about the account - who it belongs to, whether
             * it is registered, what it is subscribed to - is the server's to
             * decide. Rejecting rather than stripping unexpected fields means
             * an attempt to set one is visible instead of silently ignored.
             */
            try {
                const contact = signUpSchema.parse(req.body);

                cleanPhoneNumber(contact.phoneNumber);
                res.locals.contact = contact;
            } catch (err) {
                const message =
                    err instanceof z.ZodError
                        ? err.issues[0].message
                        : err instanceof InvalidPhoneNumberError
                          ? err.message
                          : 'Unprocessable Entity';

                return res.status(StatusCodes.UNPROCESSABLE_ENTITY).json({ error: message });
            }

            return next();
        },
        rateLimiters.signUp,
        async (req, res) => {
            const { displayName, membershipType } = /** @type {AuthenticatedSessionData} */ (
                /** @type {unknown} */ (req.session)
            );
            const signedUp = await userController.signUp({
                displayName,
                membershipType,
                contact: res.locals.contact,
            });

            if (signedUp?.undelivered.length) {
                log.warn(
                    { displayName, membershipType, undelivered: signedUp.undelivered },
                    'User signed up, but not every verification message was sent',
                );
            } else {
                log.info(
                    { displayName, membershipType },
                    signedUp ? 'User signed up' : 'User sign up failed due to conflicts',
                );
            }

            /**
             * 204 whatever happened to the messages. A conflict sends nothing,
             * so any answer that depended on how a send went would tell the
             * caller whether the address or number is already registered, and
             * a caller can make a send fail at will: a phone that has texted
             * STOP is refused by Twilio every time.
             */
            return res.status(StatusCodes.NO_CONTENT).end();
        },
    );

    /**
     * @openapi
     * /users/signUp/resend:
     *   post:
     *     summary: Resend a sign-up verification message.
     *     operationId: resendSignUp
     *     description: >
     *       Sends the pending sign-up's verification code (phone) or link (email) again,
     *       on that channel only. The same code or link goes out, so one that already
     *       arrived still works. To get new ones, sign up again.
     *     tags:
     *       - Users
     *     security:
     *       - bungieOAuth: []
     *     parameters:
     *       - $ref: '#/components/parameters/CsrfToken'
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
     *     responses:
     *       204:
     *         description: >
     *           No Content. Returned whether or not there was a pending sign-up to resend,
     *           and whether or not the message could be sent, so a conflict at sign-up is
     *           not disclosed. If nothing arrives, sign up again.
     *       400:
     *         description: Bad Request. The channel is missing or not "email" or "phone".
     *       403:
     *         description: Forbidden. Missing or invalid CSRF token.
     *       429:
     *         description: Too Many Requests. Three resends per channel every 15 minutes.
     */
    userRouter.route('/signUp/resend').post(
        (req, res, next) => middleware.authenticateUser(req, res, next),
        csrfProtection,
        requireChannel,
        rateLimiters.resend,
        async (req, res) => {
            const { displayName, membershipType } = /** @type {AuthenticatedSessionData} */ (
                /** @type {unknown} */ (req.session)
            );

            await userController.resend({
                displayName,
                membershipType,
                channel: req.body.channel,
            });

            /**
             * 204 whatever happened: whether there was a sign-up to resend
             * is what sign-up's conflict check decided, and how a send went
             * can be forced (a number that texted STOP).
             */
            return res.status(StatusCodes.NO_CONTENT).end();
        },
    );

    /**
     * @openapi
     * paths:
     *  /users:
     *    patch:
     *      summary: Update the current user's profile.
     *      operationId: updateUser
     *      description: The user is identified by the authenticated session cookie, not a path parameter. See [JSONPatch](https://jsonpatch.com) for more information.
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
     *        - $ref: '#/components/parameters/CsrfToken'
     *      requestBody:
     *        description: A JSON Patch array of replace operations to apply to the current user.
     *        content:
     *          application/json:
     *            schema:
     *              $ref: '#/components/schemas/Patch'
     *      responses:
     *        204:
     *          description: No Content.
     *        403:
     *          description: Forbidden. Missing or invalid CSRF token.
     *        422:
     *          description: Unprocessable Entity. One or more patch operations could not be applied (e.g. a notification index that does not exist).
     */
    userRouter.route('/').patch(
        (req, res, next) => middleware.authenticateUser(req, res, next),
        csrfProtection,
        async (req, res) => {
            try {
                const {
                    body: patches,
                    headers: { 'if-match': ETag },
                } = req;
                const { displayName, membershipType } = /** @type {AuthenticatedSessionData} */ (
                    /** @type {unknown} */ (req.session)
                );

                if (!ETag) {
                    return res.status(StatusCodes.PRECONDITION_REQUIRED).end();
                }

                const user = await userController.update({
                    ETag,
                    displayName,
                    membershipType,
                    patches,
                });

                return user
                    ? res.status(StatusCodes.NO_CONTENT).end()
                    : res.status(StatusCodes.NOT_FOUND).send('user not found');
            } catch (err) {
                if (err instanceof Error && err.message === 'precondition failed') {
                    return res.status(StatusCodes.PRECONDITION_FAILED).end();
                }
                if (err instanceof Error && err.message === 'invalid patch') {
                    return res.status(StatusCodes.UNPROCESSABLE_ENTITY).end();
                }

                throw err;
            }
        },
    );

    return userRouter;
};

export default routes;
