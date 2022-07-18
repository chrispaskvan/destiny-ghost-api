import {
    describe, expect, it, vi,
} from 'vitest';
import { createRequest, createResponse } from 'node-mocks-http';
import AuthenticationMiddleware from './authentication.middleware';

describe('authorizeUser', () => {
    describe('when authenticate throws', () => {
        it('should call next with err', () => {
            const req = createRequest({
                headers: {},
            });
            const res = createResponse();
            const next = vi.fn().mockImplementation(() => {});

            const err = new Error('some-error');
            const authenticationController = {
                authenticate: vi.fn().mockImplementation(() => { throw err; }),
            };
            const authenticationMiddleware = new AuthenticationMiddleware({
                authenticationController,
            });

            authenticationMiddleware.authenticateUser(req, res, next);

            expect(next).toBeCalledWith(err);
        });
    });
});
