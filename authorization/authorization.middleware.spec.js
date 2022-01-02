const httpMocks = require('node-mocks-http');
const { notificationHeaders } = require('../helpers/config');
const authorizeUser = require('./authorization.middleware');

describe('authorizeUser', () => {
    const next = jest.fn().mockImplementation(() => {});
    let res;

    beforeEach(() => {
        jest.resetAllMocks();
        res = httpMocks.createResponse();
    });

    describe('when the notification header is missing', () => {
        it('should return 403', () => {
            const req = httpMocks.createRequest({
                headers: {},
            });

            authorizeUser(req, res, next);

            expect(res.statusCode).toEqual(403);
            expect(next).not.toBeCalled();
        });
    });

    describe('when the notification header is incorrect', () => {
        it('should return 403', () => {
            const req = httpMocks.createRequest({
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
            const req = httpMocks.createRequest({
                headers: notificationHeaders,
            });

            authorizeUser(req, res, next);

            expect(next).toBeCalled();
        });
    });
});
