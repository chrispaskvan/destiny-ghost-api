import { EventEmitter } from 'events';
import {
    beforeEach, describe, expect, it, vi,
} from 'vitest';
import { StatusCodes } from 'http-status-codes';
import Chance from 'chance';
import { createResponse, createRequest } from 'node-mocks-http';
import UserRouter from './user.routes';

const chance = new Chance();
const displayName = chance.name();
const membershipType = chance.integer({ min: 1, max: 2 });
const authenticationController = {
    authenticate: vi.fn(() => ({
        displayName,
        membershipType,
    })),
};
const destinyService = {
    getCurrentUser: vi.fn(),
};
const notificationService = {
    sendMessage: vi.fn(),
};
const userService = {
    deleteUserMessages: vi.fn(),
    getUserByDisplayName: vi.fn(),
    getUserByEmailAddress: vi.fn(),
    getUserByPhoneNumber: vi.fn(),
    updateUser: vi.fn(),
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
        res = createResponse({
            eventEmitter: EventEmitter,
        });
    });

    describe('getCurrentUser', () => {
        describe('when session displayName is undefined', () => {
            it('should not return a user', () => new Promise((done, reject) => {
                const req = createRequest({
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
                        expect(res.statusCode).toEqual(StatusCodes.NOT_FOUND);
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
                const req = createRequest({
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
                        expect(res.statusCode).toEqual(StatusCodes.NOT_FOUND);
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
                    const req = createRequest({
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
                            expect(res.statusCode).toEqual(StatusCodes.OK);

                            const body = JSON.parse(res._getData());

                            expect(body).toEqual({
                                displayName: 'l',
                                links: [
                                    {
                                        href: '/destiny2/characters',
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
                    const req = createRequest({
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
                            expect(res.statusCode).toEqual(StatusCodes.UNAUTHORIZED);
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
                    const req = createRequest({
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

    describe('getUserByEmailAddress', () => {
        describe('when user is found', () => {
            it('should return no content', () => new Promise((done, reject) => {
                const req = createRequest({
                    method: 'GET',
                    url: '/cayde%40destiny-ghost.com/emailAddress',
                });

                userService.getUserByEmailAddress.mockImplementation(() => Promise.resolve({
                    bungie: {
                        accessToken: {
                            value: '11',
                        },
                    },
                }));

                res.on('end', () => {
                    try {
                        expect(res.statusCode).toEqual(StatusCodes.NO_CONTENT);
                        done();
                    } catch (err) {
                        reject(err);
                    }
                });

                userRouter(req, res);
            }));
        });

        describe('when user is not found', () => {
            it('should return not found', () => new Promise((done, reject) => {
                const req = createRequest({
                    method: 'GET',
                    url: '/cayde%40destiny-ghost.com/emailAddress',
                });

                userService.getUserByEmailAddress.mockImplementation(() => Promise.resolve());

                res.on('end', () => {
                    try {
                        expect(res.statusCode).toEqual(StatusCodes.NOT_FOUND);
                        done();
                    } catch (err) {
                        reject(err);
                    }
                });

                userRouter(req, res);
            }));
        });
    });

    describe('getUserByPhoneNumber', () => {
        describe('when user is found', () => {
            it('should return no content', () => new Promise((done, reject) => {
                const req = createRequest({
                    method: 'GET',
                    url: '/+12345678901/phoneNumber',
                });

                userService.getUserByPhoneNumber.mockImplementation(() => Promise.resolve({
                    bungie: {
                        accessToken: {
                            value: '11',
                        },
                    },
                }));

                res.on('end', () => {
                    try {
                        expect(res.statusCode).toEqual(StatusCodes.NO_CONTENT);
                        done();
                    } catch (err) {
                        reject(err);
                    }
                });

                userRouter(req, res);
            }));
        });

        describe('when user is not found', () => {
            it('should return not found', () => new Promise((done, reject) => {
                const req = createRequest({
                    method: 'GET',
                    url: '/+12345678901/phoneNumber',
                });

                userService.getUserByPhoneNumber.mockImplementation(() => Promise.resolve());

                res.on('end', () => {
                    try {
                        expect(res.statusCode).toEqual(StatusCodes.NOT_FOUND);
                        done();
                    } catch (err) {
                        reject(err);
                    }
                });

                userRouter(req, res);
            }));
        });
    });

    describe('update', () => {
        describe('when user is undefined', () => {
            it('should not return a user', () => new Promise((done, reject) => {
                const req = createRequest({
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
                const req = createRequest({
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

    describe('delete intermediary messages for a user', () => {
        describe('when phone number is invalid', () => {
            it('should return conflict', () => new Promise((done, reject) => {
                const req = createRequest({
                    method: 'DELETE',
                    url: '/%20/phoneNumber/messages',
                });

                res.on('end', () => {
                    try {
                        expect(res.statusCode).toEqual(409);
                        done();
                    } catch (err) {
                        reject(err);
                    }
                });

                userRouter(req, res);
            }));
        });

        describe('when user is not found', () => {
            it('should return not found', () => new Promise((done, reject) => {
                const req = createRequest({
                    method: 'DELETE',
                    url: '/+12345678901/phoneNumber/messages',
                });

                userService.getUserByPhoneNumber.mockImplementation(() => Promise.resolve());

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

        describe('when user is found', () => {
            it('should return success', () => new Promise((done, reject) => {
                const phoneNumber = '+12345678901';
                const req = createRequest({
                    method: 'DELETE',
                    url: `/${phoneNumber}/phoneNumber/messages`,
                });

                userService.getUserByPhoneNumber.mockImplementation(() => Promise.resolve({
                    phoneNumber,
                }));
                userService.deleteUserMessages.mockImplementation(() => Promise.resolve());

                res.on('end', () => {
                    try {
                        expect(res.statusCode).toEqual(200);
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
