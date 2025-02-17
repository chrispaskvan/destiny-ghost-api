import {
    describe, expect, it, vi,
} from 'vitest';
import { createRequest, createResponse } from 'node-mocks-http';
import AuthenticationMiddleware from './authentication.middleware';

describe('authorizeUser', () => {
    describe('when user is found', () => {
        it('should call next', async () => {
            const req = createRequest({
                headers: {},
            });
            const res = createResponse();
            const next = vi.fn().mockImplementation(() => {});
            const authenticationController = {
                authenticate: vi.fn().mockImplementation(() => ({})),
            };
            const authenticationMiddleware = new AuthenticationMiddleware({
                authenticationController,
            });

            await authenticationMiddleware.authenticateUser(req, res, next);

            expect(next).toBeCalled();
        });
    });
    describe('when user is not found', () => {
        it('should return 401', async () => {
            const req = createRequest({
                headers: {},
            });
            const res = createResponse();
            const next = vi.fn().mockImplementation(() => {});
            const authenticationController = {
                authenticate: vi.fn().mockImplementation(() => null),
            };
            const authenticationMiddleware = new AuthenticationMiddleware({
                authenticationController,
            });

            await authenticationMiddleware.authenticateUser(req, res, next);

            expect(res.statusCode).toBe(401);
        });
    });
});
