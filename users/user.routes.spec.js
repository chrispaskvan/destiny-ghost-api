const { EventEmitter } = require('events');
const HttpStatus = require('http-status-codes');
const Chance = require('chance');
const httpMocks = require('node-mocks-http');
const UserRouter = require('./user.routes');

const chance = new Chance();
const displayName = chance.name();
const membershipType = chance.integer({ min: 1, max: 2 });
const authenticationController = {
    authenticate: jest.fn(() => ({
        displayName,
        membershipType,
    })),
};
const destinyService = {
    getCurrentUser: jest.fn(),
};
const notificationService = {
    sendMessage: jest.fn(),
};
const userService = {
    getUserByDisplayName: jest.fn(),
    updateUser: jest.fn(),
};

let userRouter;

beforeEach(() => {
    userRouter = UserRouter({
        authenticationController,
        destinyService,
        notificationService,
        userService,
    });
});

describe('UserRouter', () => {
    let res;

    beforeEach(() => {
        res = httpMocks.createResponse({
            eventEmitter: EventEmitter,
        });
    });

    describe('getCurrentUser', () => {
        describe('when session displayName is undefined', () => {
            it('should not return a user', () => new Promise((done, reject) => {
                const req = httpMocks.createRequest({
                    method: 'GET',
                    url: '/current',
                    session: {
                        displayName,
                    },
                });

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

                res.on('end', () => {
                    try {
                        expect(res.statusCode).toEqual(HttpStatus.NOT_FOUND);
                        done();
                    } catch (err) {
                        reject(err);
                    }
                });

                userRouter(req, res);
            }));
        });

        describe('when session membershipType is undefined', () => {
            it('should not return a user', () => new Promise((done, reject) => {
                const req = httpMocks.createRequest({
                    method: 'GET',
                    url: '/current',
                    session: {
                        membershipType,
                    },
                });

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

                res.on('end', () => {
                    try {
                        expect(res.statusCode).toEqual(HttpStatus.NOT_FOUND);
                        done();
                    } catch (err) {
                        reject(err);
                    }
                });

                userRouter(req, res);
            }));
        });

        describe('when session displayName and membershipType are defined', () => {
            describe('when user and destiny services return a user', () => {
                it('should return the current user', () => new Promise((done, reject) => {
                    const req = httpMocks.createRequest({
                        method: 'GET',
                        url: '/current',
                        session: {
                            displayName,
                            membershipType,
                        },
                    });

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

                    res.on('end', () => {
                        try {
                            expect(res.statusCode).toEqual(HttpStatus.OK);

                            // eslint-disable-next-line no-underscore-dangle
                            const body = JSON.parse(res._getData());

                            expect(body).toEqual({
                                displayName: 'l',
                                links: [
                                    {
                                        href: '/destiny/characters',
                                        rel: 'characters',
                                    },
                                ],
                                membershipType: 2,
                                notifications: [],
                            });

                            done();
                        } catch (err) {
                            reject(err);
                        }
                    });

                    userRouter(req, res);
                }));
            });

            describe('when destiny service returns undefined', () => {
                it('should not return a user', () => new Promise((done, reject) => {
                    const req = httpMocks.createRequest({
                        method: 'GET',
                        url: '/current',
                        session: {
                            displayName,
                            membershipType,
                        },
                    });

                    destinyService.getCurrentUser.mockImplementation(() => Promise.resolve());
                    userService.getUserByDisplayName.mockImplementation(() => Promise.resolve({
                        bungie: {
                            accessToken: {
                                value: '11',
                            },
                        },
                    }));

                    res.on('end', () => {
                        try {
                            expect(res.statusCode).toEqual(HttpStatus.UNAUTHORIZED);
                            done();
                        } catch (err) {
                            reject(err);
                        }
                    });

                    userRouter(req, res);
                }));
            });

            describe('when user service returns undefined', () => {
                it('should not return a user', () => new Promise((done, reject) => {
                    const req = httpMocks.createRequest({
                        method: 'GET',
                        url: '/current',
                        session: {
                            displayName,
                            membershipType,
                        },
                    });

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

                    res.on('end', () => {
                        try {
                            expect(res.statusCode).toEqual(401);
                            done();
                        } catch (err) {
                            reject(err);
                        }
                    });

                    userRouter(req, res);
                }));
            });
        });
    });

    describe('update', () => {
        describe('when user is undefined', () => {
            it('should not return a user', () => new Promise((done, reject) => {
                const req = httpMocks.createRequest({
                    method: 'PATCH',
                    url: '/',
                    session: {},
                });

                userService.getUserByDisplayName.mockImplementation(() => Promise.resolve());

                res.on('end', () => {
                    try {
                        expect(res.statusCode).toEqual(404);
                        done();
                    } catch (err) {
                        reject(err);
                    }
                });

                userRouter(req, res);
            }));
        });

        describe('when user is defined', () => {
            it('should patch the user', () => new Promise((done, reject) => {
                const firstName = '11';
                const req = httpMocks.createRequest({
                    method: 'PATCH',
                    url: '/',
                    body: [
                        {
                            op: 'replace',
                            path: '/firstName',
                            value: firstName,
                        },
                    ],
                    session: {
                        displayName,
                        membershipType,
                    },
                });
                const user = {
                    displayName,
                    firstName: '08',
                    membershipType,
                };
                const mock = userService.updateUser;

                userService.getUserByDisplayName.mockImplementation(() => Promise.resolve(user));

                res.on('end', () => {
                    try {
                        expect(res.statusCode).toEqual(200);
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
                        done();
                    } catch (err) {
                        reject(err);
                    }
                });

                userRouter(req, res);
            }));
        });
    });
});
