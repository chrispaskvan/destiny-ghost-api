import Joi from 'joi';
import configuration from '../helpers/config';
import validate from '../helpers/validate';

/**
 * User Authentication Controller Class
 */
class AuthenticationController {
    /**
     * @constructor
     * @param options
     */
    constructor(options) {
        validate(options, {
            authenticationService: Joi.object().required(),
        });

        this.authentication = options.authenticationService;
    }

    /**
     * Authenticate user request.
     * @param req
     * @returns {Promise.<*>}
     */
    async authenticate(req) {
        const { session: { displayName, membershipType }, body: { From: phoneNumber } = {} } = req;
        const user = await this.authentication.authenticate({
            displayName,
            membershipType,
            phoneNumber,
        });

        if (user) {
            if (!displayName) {
                req.session.displayName = user.displayName;
            }
            if (!membershipType) {
                req.session.membershipType = user.membershipType;
            }

            req.session.dateRegistered = user.dateRegistered;
            req.session.membershipId = user.bungie.membership_id;
        }

        return user;
    }

    /**
     * Identify if the user is an administrator.
     *
     * @param user
     * @returns {boolean}
     */
    static isAdministrator(user) {
        return !!configuration.administrators
            .find(administrator => administrator.displayName === user.displayName
                && administrator.membershipType === user.membershipType);
    }
}

export default AuthenticationController;
