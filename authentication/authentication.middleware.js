// @ts-check
import { StatusCodes } from 'http-status-codes';
import { z } from 'zod';

/** @typedef {import('./authentication.controller.js').default} AuthenticationController */

/**
 * Constructor options for AuthenticationMiddleware.
 * @typedef {Object} AuthenticationMiddlewareOptions
 * @property {AuthenticationController} authenticationController
 */

/**
 * User Authentication Middleware Class
 */
class AuthenticationMiddleware {
    /**
     * @constructor
     * @param {AuthenticationMiddlewareOptions} options
     */
    constructor(options) {
        const schema = z.object({
            authenticationController: z.object({}),
        });

        schema.parse(options);

        /** @type {AuthenticationController} */
        this.authentication = options.authenticationController;
    }

    /**
     * Authenticate user request.
     * @param {import('express').Request} req
     * @param {import('express').Response} res
     * @param {import('express').NextFunction} next
     * @returns {Promise<void>}
     */
    async authenticateUser(req, res, next) {
        const user = await this.authentication.authenticate(req);

        if (user) {
            next();
        } else {
            res.status(StatusCodes.UNAUTHORIZED).end();
        }
    }
}

export default AuthenticationMiddleware;
