const log = require('../helpers/log');
/**
 * User Authentication Middleware Class
 */
class AuthenticationMiddleware {
    /**
     * @constructor
     * @param authenticationController
     */
    constructor(authenticationController) {
        this.authentication = authenticationController;
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
            await this.authentication.authenticate(req);
        } catch (err) {
            log.error(err);
        }
        next();
    }
}

exports = module.exports = AuthenticationMiddleware;
