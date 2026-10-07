// @ts-check
/**
 * User Authorization Middleware
 */
import { StatusCodes } from 'http-status-codes';
import configuration from '../helpers/config.js';

/** @typedef {{ header: string, key: string }} ApiKey */

/**
 * The credential a request authenticated with, which scopes anything the
 * caller names for itself - an idempotency key, say - so two callers cannot
 * collide on the same name.
 *
 * @param {import('http').IncomingHttpHeaders} headers
 * @returns {string | undefined} the matching API key's header, or
 * `notification-headers`; undefined when nothing matched
 */
const callerOf = headers => {
    /** @type {ApiKey[]} */
    const apiKeys = configuration.apiKeys;
    const apiKey = apiKeys.find(({ header, key }) => headers[header] === key);

    if (apiKey) {
        return apiKey.header;
    }

    /** @type {Record<string, string>} */
    const notificationHeaders = configuration.notificationHeaders;
    const notificationEntries = Object.entries(notificationHeaders);
    const headerEntries = Object.entries(headers).filter(([key1, value1]) =>
        notificationEntries.find(([key2, value2]) => key1 === key2 && value1 === value2),
    );

    return headerEntries.length === notificationEntries.length ? 'notification-headers' : undefined;
};

/**
 * Authenticate user request.
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 * @param {import('express').NextFunction} next
 * @returns {void}
 */
function authorizeUser(req, res, next) {
    const caller = callerOf(req.headers);

    if (!caller) {
        res.status(StatusCodes.UNAUTHORIZED).end();

        return;
    }

    res.locals.caller = caller;
    next();
}

export default authorizeUser;
