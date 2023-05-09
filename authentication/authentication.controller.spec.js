import {
    beforeEach, describe, expect, it, vi,
} from 'vitest';
import Chance from 'chance';
import AuthenticationController from './authentication.controller';
import usersJson from '../mocks/users.json';

const [mockUser] = usersJson;

vi.mock('../helpers/request');

const chance = new Chance();
const authenticationService = {
    authenticate: vi.fn(() => Promise.resolve(mockUser)),
};

let authenticationController;

beforeEach(() => {
    authenticationController = new AuthenticationController({
        authenticationService,
    });
});

describe('AuthenticationController', () => {
    describe('authenticate', () => {
        describe('when user is not defined', () => {
            it('should return user profile', async () => {
                const phoneNumber = chance.phone();
                const req = {
                    body: { From: phoneNumber },
                    session: {},
                };
                const user = await authenticationController
                    .authenticate(req);

                expect(user).toEqual(mockUser);
                expect(req.session.displayName).toEqual(mockUser.displayName);
                expect(req.session.membershipType).toEqual(mockUser.membershipType);
            });
        });
    });
});
