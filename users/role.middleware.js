// @ts-check
import { StatusCodes } from 'http-status-codes';

/** @typedef {import('../authentication/authentication.controller.js').default} AuthenticationController */

/**
 * User Authentication Middleware Class
 */
class RoleMiddleware {
    /**
     * @constructor
     * @param {{ authenticationController: AuthenticationController }} options
     */
    constructor({ authenticationController }) {
        this.authentication = authenticationController;
    }

    /**
     * Authenticate user request.
     * @param {import('express').Request} req
     * @param {import('express').Response} res
     * @param {import('express').NextFunction} next
     * @returns {Promise<void>}
     */
    async administrativeUser(req, res, next) {
        const user = await this.authentication.authenticate(req);

        if (user) {
            /**
             * `isAdministrator` is a static method, reached here via the
             * instance's `constructor` rather than a direct class import -
             * `constructor` widens to the generic `Function` type, so cast
             * it back to the specific class to see its static members.
             */
            const { isAdministrator } =
                /** @type {typeof import('../authentication/authentication.controller.js').default} */ (
                    this.authentication.constructor
                );

            if (isAdministrator(user)) {
                next();
            } else {
                res.status(StatusCodes.FORBIDDEN).end();
            }
        } else {
            res.status(StatusCodes.UNAUTHORIZED).end();
        }
    }
}

export default RoleMiddleware;
