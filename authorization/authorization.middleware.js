// @ts-check
/**
 * User Authorization Middleware
 */
import { timingSafeEqual } from 'node:crypto';
import { StatusCodes } from 'http-status-codes';
import { z } from 'zod';
import configuration from '../helpers/config.js';

/** @typedef {{ header: string, key: string }} ApiKey */

/**
 * The credentials `authorizeUser` accepts.
 * @typedef {Object} Credentials
 * @property {ApiKey[]} apiKeys - each a header and the key it must carry
 * @property {Record<string, string>} notificationHeaders - headers a
 * notification caller must send, every one of them, with these values
 */

/**
 * What the credentials must look like for the service to start. Every
 * credential that can open these routes needs a name and a value: an API key
 * with no `key` matched any request that didn't send its header, and an empty
 * `notificationHeaders` matched every request at all. Checked once, at
 * startup, so a missing setting stops the process instead of opening the
 * routes.
 */
const credentialsSchema = z.object({
    apiKeys: z.array(z.object({ header: z.string().min(1), key: z.string().min(1) })),
    notificationHeaders: z
        .record(z.string().min(1), z.string().min(1))
        .refine(headers => Object.keys(headers).length > 0, {
            message: 'needs at least one header',
        }),
});

/**
 * Throw unless the credentials could only match a caller that sends them.
 * Called from the composition root, `loaders/routes.js`, before any route
 * that uses `authorizeUser` is mounted.
 * @param {unknown} [credentials] - defaults to the loaded settings
 * @throws {Error} naming the setting at fault, never its value
 */
const assertCredentials = (credentials = configuration) => {
    const { error } = credentialsSchema.safeParse(credentials);

    if (error) {
        throw new Error(
            `Refusing to start: API credentials are incomplete (${error.issues
                .map(({ path }) => path.map(String).join('.') || 'settings')
                .join(', ')}).`,
        );
    }
};

/**
 * Compare a header's value to the one expected in constant time.
 *
 * `timingSafeEqual` throws on unequal lengths, so a value of another length
 * is compared with itself and refused. Either way the work done grows with
 * the length of what was sent, not with anything about the expected value,
 * so the comparison leaks no more than whether the length was right.
 *
 * Not hashed first to even out the lengths: a fast digest of a credential is
 * what CodeQL's `js/insufficient-password-hash` looks for, and nothing here
 * needs one. A missing header, a repeated one (an array), or an empty
 * expectation never matches.
 * @param {string | string[] | undefined} given
 * @param {string | undefined} expected
 * @returns {boolean}
 */
const isSameSecret = (given, expected) => {
    if (typeof given !== 'string' || typeof expected !== 'string' || !expected) {
        return false;
    }

    const sent = Buffer.from(given);
    const wanted = Buffer.from(expected);

    if (sent.length !== wanted.length) {
        timingSafeEqual(sent, sent);

        return false;
    }

    return timingSafeEqual(sent, wanted);
};

/**
 * The credential a request authenticated with, which scopes anything the
 * caller names for itself - an idempotency key, say - so two callers cannot
 * collide on the same name.
 *
 * Header names are looked up lowercased, as Node delivers them, so a key
 * configured as `X-Api-Key` matches. Defensive even after `assertCredentials`:
 * an entry missing a header or key, or an empty set of notification headers,
 * matches nothing.
 * @param {import('http').IncomingHttpHeaders} headers
 * @param {Credentials} [credentials] - defaults to the loaded settings
 * @returns {string | undefined} the matching API key's header, or
 * `notification-headers`; undefined when nothing matched
 */
const callerOf = (headers, credentials = configuration) => {
    const { apiKeys = [], notificationHeaders = {} } = credentials ?? {};
    const apiKey = apiKeys.find(
        ({ header, key }) =>
            typeof header === 'string' &&
            header &&
            isSameSecret(headers[header.toLowerCase()], key),
    );

    if (apiKey) {
        return apiKey.header;
    }

    const required = Object.entries(notificationHeaders);
    const allSent =
        required.length > 0 &&
        required.every(([name, value]) => isSameSecret(headers[name.toLowerCase()], value));

    return allSent ? 'notification-headers' : undefined;
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
export { assertCredentials, callerOf };
