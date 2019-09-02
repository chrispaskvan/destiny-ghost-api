const Joi = require('@hapi/joi');
const validate = require('../helpers/validate');

/**
 * User Authentication Middleware Class
 */
class AuthenticationMiddleware {
    /**
     * @constructor
     * @param options
     */
    constructor(options) {
        validate(options, {
            authenticationController: Joi.object().required(),
        });

        this.authentication = options.authenticationController;
    }

    /**
     * Authenticate user request.
     * @param req
     * @param res
     * @param next
     * @returns {Promise.<void>}
     */
    async authenticateUser(req, res, next) {
        try {
            const user = await this.authentication.authenticate(req);

            if (user) {
                next();
            } else {
                res.status(401).end();
            }
        } catch (err) {
            next(err);
        }
    }
}

module.exports = AuthenticationMiddleware;
