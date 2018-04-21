const log = require('../helpers/log');

/**
 * User Authentication Middleware Class
 */
class AuthenticationMiddleware {
    /**
     * @constructor
     * @param authenticationController
     */
    constructor({ authenticationController }) {
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
            const user = await this.authentication.authenticate(req);
            if (user) {
                next();
            } else {
                res.status(401).end();
            }
        } catch (err) {
            log.error(err);
            next();
        }
    }
}

module.exports = AuthenticationMiddleware;
