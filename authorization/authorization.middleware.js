/**
 * User Authorization Middleware
 */
import { StatusCodes } from 'http-status-codes';
import configuration from '../helpers/config.js';

/**
 * Check for expected notification headers.
 *
 * @param {*} headers
 */
const authorized = headers => {
    const apiKeyEntries = configuration.apiKeys.map(({ header, key }) => [header, key]);
    const notificationEntries = Object.entries(configuration.notificationHeaders);
    const authorizedEntries = apiKeyEntries.concat(notificationEntries);
    const headerEntries = Object.entries(headers)
        .filter(([key1, value1]) => authorizedEntries
            .find(([key2, value2]) => key1 === key2 && value1 === value2));

    return headerEntries.length;
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
        return res.status(StatusCodes.UNAUTHORIZED).end();
    }

    next();
}

export default authorizeUser;
