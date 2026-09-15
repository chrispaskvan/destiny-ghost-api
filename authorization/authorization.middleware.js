// @ts-check
/**
 * User Authorization Middleware
 */
import { StatusCodes } from 'http-status-codes';
import configuration from '../helpers/config.js';

/** @typedef {{ header: string, key: string }} ApiKey */

/**
 * Check for expected notification headers.
 *
 * @param {import('http').IncomingHttpHeaders} headers
 * @returns {boolean}
 */
const authorized = headers => {
    /** @type {ApiKey[]} */
    const apiKeys = configuration.apiKeys;
    const apiKeyEntries = apiKeys.map(({ header, key }) => [header, key]);
    const apiKeyPresent = apiKeyEntries.some(([header, key]) => headers[header] === key);
    /** @type {Record<string, string>} */
    const notificationHeaders = configuration.notificationHeaders;
    const notificationEntries = Object.entries(notificationHeaders);
    const headerEntries = Object.entries(headers).filter(([key1, value1]) =>
        notificationEntries.find(([key2, value2]) => key1 === key2 && value1 === value2),
    );

    return apiKeyPresent || headerEntries.length === notificationEntries.length;
};

/**
 * Authenticate user request.
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 * @param {import('express').NextFunction} next
 * @returns {void}
 */
function authorizeUser(req, res, next) {
    const { headers } = req;

    if (!authorized(headers)) {
        res.status(StatusCodes.UNAUTHORIZED).end();

        return;
    }

    next();
}

export default authorizeUser;
