// @ts-check
import { z } from 'zod';
import configuration from '../helpers/config.js';

/** @typedef {import('./authentication.service.js').default} AuthenticationService */
/** @typedef {import('../users/user.service.js').User} User */
/** @typedef {import('../users/user.routes.js').AppSessionData} AppSessionData */

/**
 * Constructor options for AuthenticationController.
 * @typedef {Object} AuthenticationControllerOptions
 * @property {AuthenticationService} authenticationService
 */

/**
 * User Authentication Controller Class
 */
class AuthenticationController {
    /**
     * @constructor
     * @param {AuthenticationControllerOptions} options
     */
    constructor(options) {
        const schema = z.object({
            authenticationService: z.object({}),
        });

        schema.parse(options);

        /** @type {AuthenticationService} */
        this.authentication = options.authenticationService;
    }

    /**
     * Authenticate user request.
     * @param {import('express').Request} req
     * @returns {Promise<User | undefined>}
     */
    async authenticate(req) {
        const { displayName, membershipType } = /** @type {AppSessionData} */ (req.session);
        const { From: phoneNumber } = /** @type {{ From?: string }} */ (req.body ?? {});
        const user = await this.authentication.authenticate({
            displayName,
            membershipType,
            phoneNumber,
        });

        if (user) {
            const session = /** @type {AppSessionData} */ (req.session);

            if (!displayName) {
                session.displayName = user.displayName;
            }
            if (!membershipType) {
                session.membershipType = user.membershipType;
            }

            session.dateRegistered = user.dateRegistered;
            session.membershipId = user.bungie?.membership_id;
        }

        return user;
    }

    /**
     * Identify if the user is an administrator.
     *
     * @param {{ displayName: string, membershipType: number }} user
     * @returns {boolean}
     */
    static isAdministrator(user) {
        /** @type {{ displayName: string, membershipType: number }[]} */
        const administrators = configuration.administrators;

        return !!administrators.find(
            administrator =>
                administrator.displayName === user.displayName &&
                administrator.membershipType === user.membershipType,
        );
    }
}

export default AuthenticationController;
