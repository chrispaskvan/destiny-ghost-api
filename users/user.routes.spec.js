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
    constructor: {
        isAdministrator: vi.fn(() => true),
    },
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
    const next = vi.fn();
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

                userRouter(req, res, next);
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

                userRouter(req, res, next);
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
                        displayName: 'l',
                        membershipType: 2,
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
                                notifications: [],
                            });

                            done();
                        } catch (err) {
                            reject(err);
                        }
                    });

                    userRouter(req, res, next);
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
                        displayName: 'l',
                        membershipType: 2,
                    }));

                    res.on('end', () => {
                        try {
                            expect(res.statusCode).toEqual(StatusCodes.UNAUTHORIZED);
                            done();
                        } catch (err) {
                            reject(err);
                        }
                    });

                    userRouter(req, res, next);
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
                            expect(res.statusCode).toEqual(StatusCodes.UNAUTHORIZED);
                            done();
                        } catch (err) {
                            reject(err);
                        }
                    });

                    userRouter(req, res, next);
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

                userRouter(req, res, next);
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

                userRouter(req, res, next);
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

                userRouter(req, res, next);
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

                userRouter(req, res, next);
            }));
        });
    });

    describe('update', () => {
        describe('when If-Match header is not defined', () => {
            it('should return precondition failed', () => new Promise((done, reject) => {
                const req = createRequest({
                    method: 'PATCH',
                    url: '/',
                    session: {},
                });

                res.on('end', () => {
                    try {
                        expect(res.statusCode).toEqual(StatusCodes.PRECONDITION_REQUIRED);
                        done();
                    } catch (err) {
                        reject(err);
                    }
                });

                userRouter(req, res, next);
            }));
        });
        describe('when user is undefined', () => {
            it('should not return a user', () => new Promise((done, reject) => {
                const req = createRequest({
                    headers: {
                        'if-match': '02',
                    },
                    method: 'PATCH',
                    url: '/',
                    session: {},
                });

                userService.getUserByDisplayName.mockImplementation(() => Promise.resolve());

                res.on('end', () => {
                    try {
                        expect(res.statusCode).toEqual(StatusCodes.NOT_FOUND);
                        done();
                    } catch (err) {
                        reject(err);
                    }
                });

                userRouter(req, res, next);
            }));
        });

        describe('when user is defined', () => {
            const ETag = '02';
            const firstName = '11';

            describe('when ETag does match', () => {
                it('should patch the user', () => new Promise((done, reject) => {
                    const req = createRequest({
                        headers: {
                            'if-match': ETag,
                        },
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
                        _etag: ETag,
                        displayName,
                        firstName: '08',
                        membershipType,
                    };
                    const mock = userService.updateUser;

                    userService.getUserByDisplayName.mockImplementation(() => Promise.resolve(user));

                    res.on('end', () => {
                        try {
                            expect(res.statusCode).toEqual(StatusCodes.NO_CONTENT);
                            expect(mock).toHaveBeenCalledWith({
                                _etag: ETag,
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

                    userRouter(req, res, next);
                }));
            });
            describe('when ETag does not match', () => {
                it('should return precondition failed', () => new Promise((done, reject) => {
                    const req = createRequest({
                        headers: {
                            'if-match': ETag,
                        },
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
                        _etag: 'x',
                        displayName,
                        firstName: '08',
                        membershipType,
                    };

                    userService.getUserByDisplayName.mockImplementation(() => Promise.resolve(user));

                    res.on('end', () => {
                        try {
                            expect(res.statusCode).toEqual(StatusCodes.PRECONDITION_FAILED);
                            done();
                        } catch (err) {
                            reject(err);
                        }
                    });

                    userRouter(req, res, next);
                }));
            });
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
                        expect(res.statusCode).toEqual(StatusCodes.CONFLICT);
                        done();
                    } catch (err) {
                        reject(err);
                    }
                });

                userRouter(req, res, next);
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
                        expect(res.statusCode).toEqual(StatusCodes.NOT_FOUND);
                        done();
                    } catch (err) {
                        reject(err);
                    }
                });

                userRouter(req, res, next);
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
                        expect(res.statusCode).toEqual(StatusCodes.OK);
                        done();
                    } catch (err) {
                        reject(err);
                    }
                });

                userRouter(req, res, next);
            }));
        });
    });
});
