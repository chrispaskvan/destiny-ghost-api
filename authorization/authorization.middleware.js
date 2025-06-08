/**
 * User Authorization Middleware
 */
import { StatusCodes } from 'http-status-codes';
import configuration from '../helpers/config';

/**
 * Check for expected notification headers.
 *
 * @param {*} headers
 */
const authorized = headers => {
    const notificationEntries = Object.entries(configuration.notificationHeaders);
    const headerEntries = Object.entries(headers)
        .filter(([key1, value1]) => notificationEntries
            .find(([key2, value2]) => key1 === key2 && value1 === value2));

    return headerEntries.length === notificationEntries.length;
};

/**
 * Authenticate user request.
 * @param req
 * @param res
 * @param next
 * @returns {Promise.<void>}
 */
function authorizeUser(req, res, next) {
    const { headers } = req;

    if (!authorized(headers)) {
        res.writeHead(StatusCodes.UNAUTHORIZED);
        res.end();

        return;
    }

    next();
}

export default authorizeUser;
