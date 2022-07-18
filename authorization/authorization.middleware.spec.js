import {
    beforeEach, describe, expect, it, vi,
} from 'vitest';
import { createResponse, createRequest } from 'node-mocks-http';
import configuration from '../helpers/config';
import authorizeUser from './authorization.middleware';

describe('authorizeUser', () => {
    const next = vi.fn().mockImplementation(() => {});
    let res;

    beforeEach(() => {
        vi.resetAllMocks();
        res = createResponse();
    });

    describe('when the notification header is missing', () => {
        it('should return 403', () => {
            const req = createRequest({
                headers: {},
            });

            authorizeUser(req, res, next);

            expect(res.statusCode).toEqual(403);
            expect(next).not.toBeCalled();
        });
    });

    describe('when the notification header is incorrect', () => {
        it('should return 403', () => {
            const req = createRequest({
                headers: {
                    'x-destiny-': 'thorn',
                },
            });

            authorizeUser(req, res, next);

            expect(res.statusCode).toEqual(403);
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
