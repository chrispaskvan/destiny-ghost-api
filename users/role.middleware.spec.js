const { EventEmitter } = require('events');
const httpMocks = require('node-mocks-http');
const RoleMiddleware = require('./role.middleware');

jest.mock('../helpers/config', () => ({
    administrators: [{
        displayName: 'PocketInfinity',
        membershipType: 2,
    }],
}), { virtual: true });

const authenticationController = {
    authenticate: jest.fn(),
};

let roleMiddleWare;

beforeEach(() => {
    roleMiddleWare = new RoleMiddleware({ authenticationController });
});

describe('RoleMiddleware', () => {
    let req;
    let res;

    beforeEach(() => {
        req = httpMocks.createRequest();
        res = httpMocks.createResponse({
            eventEmitter: EventEmitter,
        });
    });

    describe('administrativeUser', () => {
        describe('when user is an administrator', () => {
            it('should call next without an error', async () => {
                const next = jest.fn();

                authenticationController.authenticate
                    .mockImplementation(() => Promise.resolve({
                        displayName: 'PocketInfinity',
                        membershipType: 2,
                    }));

                await roleMiddleWare.administrativeUser(req, res, next);

                expect(next).toHaveBeenCalled();
            });
        });

        describe('when user is not an administrator', () => {
            it('should call next with an error', async () => {
                const next = jest.fn();

                authenticationController.authenticate
                    .mockImplementation(() => Promise.resolve({
                        displayName: 'Eyasluna',
                        membershipType: 2,
                    }));

                await roleMiddleWare.administrativeUser(req, res, next);

                expect(next).not.toHaveBeenCalled();
            });
        });
    });
});
