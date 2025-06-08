import {
    beforeEach, describe, expect, it, vi,
} from 'vitest';
import { createResponse, createRequest } from 'node-mocks-http';
import configuration from '../helpers/config';
import authorizeUser from './authorization.middleware';
import { StatusCodes } from 'http-status-codes';

describe('authorizeUser', () => {
    const next = vi.fn().mockImplementation(() => {});
    let res;

    beforeEach(() => {
        vi.resetAllMocks();
        res = createResponse();
    });

    describe('when the notification header is missing', () => {
        it('should return 401', () => {
            const req = createRequest({
                headers: {},
            });

            authorizeUser(req, res, next);

            expect(res.statusCode).toEqual(StatusCodes.UNAUTHORIZED);
            expect(next).not.toBeCalled();
        });
    });

    describe('when the notification header is incorrect', () => {
        it('should return 401', () => {
            const req = createRequest({
                headers: {
                    'x-destiny-': 'thorn',
                },
            });

            authorizeUser(req, res, next);

            expect(res.statusCode).toEqual(StatusCodes.UNAUTHORIZED);
            expect(next).not.toBeCalled();
        });
    });

    describe('when the notification header is correct', () => {
        it('should call next', () => {
            const req = createRequest({
                headers: configuration.notificationHeaders,
            });

            authorizeUser(req, res, next);

            expect(next).toBeCalled();
        });
    });
});
