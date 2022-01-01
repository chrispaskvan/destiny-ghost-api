const httpMocks = require('node-mocks-http');
const AuthenticationMiddleware = require('./authentication.middleware');

describe('authorizeUser', () => {
    describe('when authenticate throws', () => {
        it('should call next with err', () => {
            const req = httpMocks.createRequest({
                headers: {},
            });
            const res = httpMocks.createResponse();
            const next = jest.fn().mockImplementation(() => {});

            const err = new Error('some-error');
            const authenticationController = {
                authenticate: jest.fn().mockImplementation(() => { throw err; }),
            };
            const authenticationMiddleware = new AuthenticationMiddleware({
                authenticationController,
            });

            authenticationMiddleware.authenticateUser(req, res, next);

            expect(next).toBeCalledWith(err);
        });
    });
});
