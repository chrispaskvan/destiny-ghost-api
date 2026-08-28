import { StatusCodes, getReasonPhrase } from 'http-status-codes';
import { createRequest, createResponse } from 'node-mocks-http';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import DestinyError from '../destiny/destiny.error.js';
import ResponseError from '../helpers/response.error.js';
import errorMiddleware from './error.middleware.js';

vi.mock('../helpers/log.js', () => ({
    default: {
        error: vi.fn(),
    },
}));

describe('errorMiddleware', () => {
    const next = vi.fn();
    let req;
    let res;

    beforeEach(() => {
        vi.clearAllMocks();
        req = createRequest();
        res = createResponse();
    });

    describe('when the error is a DestinyError', () => {
        it('should return 404 with the curated Bungie fields', () => {
            const err = new DestinyError(1618, 'DestinyAccountNotFound', 'Account not found.');

            errorMiddleware(err, req, res, next);

            expect(res.statusCode).toEqual(StatusCodes.NOT_FOUND);
            expect(res._getJSONData()).toEqual({
                errors: [
                    {
                        code: 1618,
                        message: 'DestinyAccountNotFound',
                        status: 'Account not found.',
                    },
                ],
            });
            expect(next).not.toBeCalled();
        });
    });

    describe('when the error is a ResponseError', () => {
        it('should return 500 with the upstream status only', () => {
            const err = new ResponseError({
                response: {
                    data: { secret: 'internal detail' },
                    status: 503,
                    statusText: 'Service Unavailable',
                },
            });

            errorMiddleware(err, req, res, next);

            expect(res.statusCode).toEqual(StatusCodes.INTERNAL_SERVER_ERROR);
            expect(res._getJSONData()).toEqual({
                errors: [
                    {
                        status: 503,
                        statusText: 'Service Unavailable',
                    },
                ],
            });
        });
    });

    describe('when the error is unhandled and not marked client safe', () => {
        it('should return 500 without disclosing the message', () => {
            const err = new Error('the stored record has no refresh_token');

            errorMiddleware(err, req, res, next);

            expect(res.statusCode).toEqual(StatusCodes.INTERNAL_SERVER_ERROR);
            expect(res._getJSONData()).toEqual({
                errors: [
                    {
                        message: getReasonPhrase(StatusCodes.INTERNAL_SERVER_ERROR),
                    },
                ],
            });
            expect(res._getData()).not.toContain('refresh_token');
        });

        it('should honor the error status code but still withhold the message', () => {
            const err = new Error('Session store unavailable.');

            err.statusCode = StatusCodes.SERVICE_UNAVAILABLE;

            errorMiddleware(err, req, res, next);

            expect(res.statusCode).toEqual(StatusCodes.SERVICE_UNAVAILABLE);
            expect(res._getJSONData()).toEqual({
                errors: [
                    {
                        message: getReasonPhrase(StatusCodes.SERVICE_UNAVAILABLE),
                    },
                ],
            });
        });
    });

    describe('when the error is marked client safe', () => {
        it('should forward the message', () => {
            const err = new Error('Unexpected token } in JSON at position 5');

            Object.assign(err, {
                expose: true,
                statusCode: StatusCodes.BAD_REQUEST,
            });

            errorMiddleware(err, req, res, next);

            expect(res.statusCode).toEqual(StatusCodes.BAD_REQUEST);
            expect(res._getJSONData()).toEqual({
                errors: [
                    {
                        message: 'Unexpected token } in JSON at position 5',
                    },
                ],
            });
        });
    });

    describe('when the error carries an unusable status code', () => {
        it.each([0, 200, '418', 999, null, Number.NaN])(
            'should fall back to 500 for %p',
            statusCode => {
                const err = new Error('boom');

                err.statusCode = statusCode;

                errorMiddleware(err, req, res, next);

                expect(res.statusCode).toEqual(StatusCodes.INTERNAL_SERVER_ERROR);
            },
        );
    });

    describe('when the headers have already been sent', () => {
        it('should delegate to next', () => {
            const err = new Error('too late');

            res.headersSent = true;

            errorMiddleware(err, req, res, next);

            expect(next).toBeCalledWith(err);
        });
    });
});
