const chance = require('chance')();
const UserController = require('./user.controller');

const displayName = chance.name();
const membershipType = chance.integer({ min: 1, max: 2 });

const destinyService = {
    getCurrentUser: jest.fn(),
};
const userService = {
    getUserByDisplayName: jest.fn(),
    updateUser: jest.fn(),
};

let userController;

beforeEach(() => {
    userController = new UserController({ destinyService, userService });
});

describe('UserController', () => {
    describe('getCurrentUser', () => {
        describe('when session displayName and membershipType are defined', () => {
            describe('when user and destiny services return a user', () => {
                it('should return the current user', async () => {
                    destinyService.getCurrentUser.mockImplementation(() => Promise.resolve({
                        displayName: 'l',
                        membershipType: 2,
                        links: [
                            {
                                rel: 'characters',
                                href: '/destiny/characters',
                            },
                        ],
                    }));
                    userService.getUserByDisplayName.mockImplementation(() => Promise.resolve({
                        bungie: {
                            accessToken: {
                                value: '11',
                            },
                        },
                    }));

                    const user = await userController.getCurrentUser(displayName, membershipType);

                    expect(user).not.toBeUndefined();
                });
            });

            describe('when destiny service returns undefined', () => {
                it('should not return a user', async () => {
                    destinyService.getCurrentUser.mockImplementation(() => Promise.resolve());
                    userService.getUserByDisplayName.mockImplementation(() => Promise.resolve({
                        bungie: {
                            accessToken: {
                                value: '11',
                            },
                        },
                    }));

                    const user = await userController.getCurrentUser(displayName, membershipType);

                    expect(user).toBeUndefined();
                });
            });

            describe('when user service returns undefined', () => {
                it('should not return a user', async () => {
                    destinyService.getCurrentUser.mockImplementation(() => Promise.resolve({
                        displayName: 'l',
                        membershipType: 2,
                        links: [
                            {
                                rel: 'characters',
                                href: '/destiny/characters',
                            },
                        ],
                    }));
                    userService.getUserByDisplayName.mockImplementation(() => Promise.resolve());

                    const user = await userController.getCurrentUser(displayName, membershipType);

                    expect(user).toBeUndefined();
                });
            });
        });
    });

    describe('update', () => {
        describe('when user is undefined', () => {
            it('should not return a user', async () => {
                userService.getUserByDisplayName.mockImplementation(() => Promise.resolve());

                const user = await userController.update({
                    displayName,
                    membershipType,
                    patches: [],
                });

                expect(user).toBeUndefined();
            });
        });

        describe('when user is defined', () => {
            it('should patch the user', async () => {
                const firstName = '11';
                const patches = [
                    {
                        op: 'replace',
                        path: '/firstName',
                        value: firstName,
                    },
                ];
                const user = {
                    displayName,
                    firstName: '08',
                    membershipType,
                };
                const mock = userService.updateUser;

                userService.getUserByDisplayName.mockImplementation(() => Promise.resolve(user));

                const patchedUser = await userController.update({
                    displayName,
                    membershipType,
                    patches,
                });

                expect(patchedUser).not.toBeUndefined();
                expect(mock).toHaveBeenCalledWith({
                    displayName,
                    firstName,
                    membershipType,
                    version: 2,
                    patches: [
                        {
                            patch: [
                                {
                                    op: 'replace',
                                    path: '/firstName',
                                    value: '08',
                                },
                            ],
                            version: 1,
                        },
                    ],
                });
            });
        });
    });
});
