import { beforeEach, describe, expect, it, vi } from 'vitest';
import Chance from 'chance';
import AuthenticationController from './authentication.controller.js';
import config from '../helpers/config.js';
import usersJson from '../mocks/users.json';

const [mockUser] = usersJson;

vi.mock('../helpers/request.js');

const chance = new Chance();
const authenticationService = {
    authenticate: vi.fn(() => Promise.resolve(mockUser)),
};

let authenticationController;

beforeEach(() => {
    vi.clearAllMocks();
    authenticationController = new AuthenticationController({
        authenticationService,
    });
});

describe('AuthenticationController', () => {
    describe('authenticate', () => {
        it.each([{}, { displayName: 'Guardian' }, { membershipType: 2 }])(
            'does not authenticate a phone number when session identity is incomplete: %j',
            async session => {
                const originalSession = { ...session };
                const req = { body: { From: chance.phone() }, session };

                const user = await authenticationController.authenticate(req);

                expect(user).toBeUndefined();
                expect(authenticationService.authenticate).not.toHaveBeenCalled();
                expect(session).toEqual(originalSession);
            },
        );

        it('authenticates only the session identity even when the body names another sender', async () => {
            const { displayName, membershipType } = mockUser;
            const req = {
                body: { From: chance.phone() },
                session: { displayName, membershipType },
            };

            const user = await authenticationController.authenticate(req);

            expect(user).toEqual(mockUser);
            expect(authenticationService.authenticate).toHaveBeenCalledExactlyOnceWith({
                displayName,
                membershipType,
            });
            expect(req.session).toEqual({
                displayName,
                membershipType,
                dateRegistered: mockUser.dateRegistered,
                membershipId: mockUser.bungie?.membership_id,
            });
        });
    });

    describe('isAdministrator', () => {
        describe('when user is not an administrator', () => {
            it('should return false', async () => {
                const isAdministrator = await AuthenticationController.isAdministrator({
                    displayName: chance.name(),
                    membershipType: chance.integer(),
                });

                expect(isAdministrator).toBeFalsy();
            });
        });

        describe('when user is an administrator', () => {
            it('should return true', async () => {
                vi.spyOn(config, 'administrators', 'get').mockReturnValue([mockUser]);

                const isAdministrator = await AuthenticationController.isAdministrator(mockUser);

                expect(isAdministrator).toBeTruthy();
            });
        });
    });
});
