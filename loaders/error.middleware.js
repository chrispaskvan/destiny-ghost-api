import { StatusCodes, getReasonPhrase } from 'http-status-codes';

import DestinyError from '../destiny/destiny.error.js';
import ResponseError from '../helpers/response.error.js';
import log from '../helpers/log.js';

/**
 * Status codes an error is allowed to select for its response.
 *
 * Membership also guarantees getReasonPhrase resolves, since it throws for
 * codes outside its map.
 */
const errorStatusCodes = new Set(
    Object.values(StatusCodes).filter(statusCode => Number.isInteger(statusCode)),
);

/**
 * Honor an error's own status code only when it is a recognized error status.
 *
 * @param {*} statusCode - The statusCode property carried by the error, if any.
 * @returns {number}
 */
const resolveStatusCode = statusCode =>
    errorStatusCodes.has(statusCode) && statusCode >= StatusCodes.BAD_REQUEST
        ? statusCode
        : StatusCodes.INTERNAL_SERVER_ERROR;

/**
 * Global error handler.
 *
 * Error messages are private by default: the fallback branch replies with the
 * status's reason phrase, never err.message, and the real message reaches the
 * log only. To speak to a client, set expose to true on the error — the
 * convention http-errors and body-parser already follow — and write a message
 * that names no internal concept.
 *
 * @param {Error} err
 * @param {import('express').Request} _req
 * @param {import('express').Response} res
 * @param {import('express').NextFunction} next
 */
const errorMiddleware = (err, _req, res, next) => {
    const { code, expose, message, status, statusText } = err;

    log.error(err);

    if (res.headersSent) {
        next(err);

        return;
    }

    if (err instanceof DestinyError) {
        res.status(StatusCodes.NOT_FOUND).json({
            errors: [
                {
                    code,
                    message,
                    status,
                },
            ],
        });
    } else if (err instanceof ResponseError) {
        res.status(StatusCodes.INTERNAL_SERVER_ERROR).json({
            errors: [
                {
                    status,
                    statusText,
                },
            ],
        });
    } else {
        const statusCode = resolveStatusCode(err.statusCode);

        res.status(statusCode).json({
            errors: [
                {
                    message: expose === true ? message : getReasonPhrase(statusCode),
                },
            ],
        });
    }
};

export default errorMiddleware;
