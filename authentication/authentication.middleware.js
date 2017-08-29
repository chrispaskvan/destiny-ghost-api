const log = require('../helpers/log');
/**
 * User Authentication Middleware Class
 */
class AuthenticationMiddleware {
    constructor(authenticationController) {
        this.authentication = authenticationController;
    }

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
