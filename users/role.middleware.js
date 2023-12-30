import { StatusCodes } from 'http-status-codes';
import configuration from '../helpers/config';

/**
 * User Authentication Middleware Class
 */
class RoleMiddleware {
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
    async administrativeUser(req, res, next) {
        try {
            const user = await this.authentication.authenticate(req);

            if (user) {
                if (configuration.administrators
                    .find(administrator => administrator.displayName === user.displayName
                        && administrator.membershipType === user.membershipType)) {
                    next();
                } else {
                    res.status(StatusCodes.UNAUTHORIZED).end();
                }
            } else {
                res.status(StatusCodes.UNAUTHORIZED).end();
            }
        } catch (err) {
            next(err);
        }
    }
}

export default RoleMiddleware;
