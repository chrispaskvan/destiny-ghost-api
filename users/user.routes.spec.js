import { EventEmitter } from 'node:events';
import {
    beforeEach, describe, expect, it, vi,
} from 'vitest';
import { StatusCodes } from 'http-status-codes';
import Chance from 'chance';
import { createResponse, createRequest } from 'node-mocks-http';
import UserRouter from './user.routes';

vi.mock('../helpers/postmaster', () => ({
    default: vi.fn().mockImplementation(() => ({
        confirm: vi.fn().mockResolvedValue({ messageId: 'test-email-id' }),
    })),
}));
vi.mock('../helpers/tokens', () => ({
    getBlob: vi.fn(() => 'test-blob-token'),
    getCode: vi.fn(() => '123456'),
}));
vi.mock('../helpers/get-epoch', () => ({
    default: vi.fn(() => Math.floor(Date.now() / 1000)),
}));

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
    getUserByDisplayName: vi.fn(),
    updateUser: vi.fn(),
};
const worldRepository = {
    getVendorIcon: vi.fn(() => 'https://example.com/icon.png'),
};

let userRouter;

beforeEach(() => {
    userRouter = UserRouter({
        authenticationController,
        destinyService,
        notificationService,
        userService,
        worldRepository,
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

    describe('GET /users/current', () => {
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

    describe('PATCH /users', () => {
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

            describe('when a generic error occurs', () => {
                it('should re-throw the error', () => new Promise((done, reject) => {
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
                    const genericError = new Error('Database connection failed');
                    let responseEnded = false;
                    let errorOccurred = false;

                    userService.getUserByDisplayName.mockImplementation(() => Promise.reject(genericError));

                    res.on('end', () => {
                        responseEnded = true;
                        if (!errorOccurred) {
                            reject(new Error('Expected error to be thrown, but request completed normally'));
                        }
                    });
                    setTimeout(() => {
                        if (!responseEnded) {
                            errorOccurred = true;
                            done();
                        }
                    }, 50);

                    userRouter(req, res, next);
                }));
            });
        });
    });

    describe('POST /users/current/ciphers', () => {
        const phoneNumber = '+1234567890';
        const emailAddress = 'test@example.com';

        describe('when channel is email', () => {
            it('should send verification code and return 202', () => new Promise((done, reject) => {
                const req = createRequest({
                    method: 'POST',
                    url: '/current/ciphers',
                    body: { channel: 'email' },
                    session: {
                        displayName,
                        membershipType,
                    },
                });
                const user = {
                    displayName,
                    membershipType,
                    dateRegistered: new Date().toISOString(),
                    emailAddress,
                    phoneNumber,
                };

                userService.getUserByDisplayName.mockImplementation(() => Promise.resolve(user));
                userService.updateUser.mockImplementation(() => Promise.resolve(user));

                res.on('end', () => {
                    try {
                        expect(res.statusCode).toEqual(StatusCodes.ACCEPTED);
                        expect(userService.getUserByDisplayName).toHaveBeenCalledWith(displayName, membershipType);
                        expect(userService.updateUser).toHaveBeenCalled();
                        done();
                    } catch (err) {
                        reject(err);
                    }
                });

                userRouter(req, res, next);
            }));
        });

        describe('when channel is phone', () => {
            it('should send verification code and return 202', () => new Promise((done, reject) => {
                const req = createRequest({
                    method: 'POST',
                    url: '/current/ciphers',
                    body: { channel: 'phone' },
                    session: {
                        displayName,
                        membershipType,
                    },
                });
                const user = {
                    displayName,
                    membershipType,
                    dateRegistered: new Date().toISOString(),
                    emailAddress,
                    phoneNumber,
                };

                userService.getUserByDisplayName.mockImplementation(() => Promise.resolve(user));
                userService.updateUser.mockImplementation(() => Promise.resolve(user));
                notificationService.sendMessage.mockImplementation(() => Promise.resolve({ sid: 'test-message-id' }));

                res.on('end', () => {
                    try {
                        expect(res.statusCode).toEqual(StatusCodes.ACCEPTED);
                        expect(userService.getUserByDisplayName).toHaveBeenCalledWith(displayName, membershipType);
                        expect(notificationService.sendMessage).toHaveBeenCalled();
                        expect(userService.updateUser).toHaveBeenCalled();
                        done();
                    } catch (err) {
                        reject(err);
                    }
                });

                userRouter(req, res, next);
            }));
        });

        describe('when channel is invalid', () => {
            it('should return 400 Bad Request', () => new Promise((done, reject) => {
                const req = createRequest({
                    method: 'POST',
                    url: '/current/ciphers',
                    body: { channel: 'invalid' },
                    session: {
                        displayName,
                        membershipType,
                    },
                });

                res.on('end', () => {
                    try {
                        expect(res.statusCode).toEqual(StatusCodes.BAD_REQUEST);
                        expect(res._getData()).toContain('Invalid channel');
                        done();
                    } catch (err) {
                        reject(err);
                    }
                });

                userRouter(req, res, next);
            }));
        });

        describe('when channel is missing', () => {
            it('should return 400 Bad Request', () => new Promise((done, reject) => {
                const req = createRequest({
                    method: 'POST',
                    url: '/current/ciphers',
                    body: {},
                    session: {
                        displayName,
                        membershipType,
                    },
                });

                res.on('end', () => {
                    try {
                        expect(res.statusCode).toEqual(StatusCodes.BAD_REQUEST);
                        expect(res._getData()).toContain('Invalid channel');
                        done();
                    } catch (err) {
                        reject(err);
                    }
                });

                userRouter(req, res, next);
            }));
        });

        describe('when user is not found', () => {
            it('should return 400 Bad Request', () => new Promise((done, reject) => {
                const req = createRequest({
                    method: 'POST',
                    url: '/current/ciphers',
                    body: { channel: 'email' },
                    session: {
                        displayName,
                        membershipType,
                    },
                });

                userService.getUserByDisplayName.mockImplementation(() => Promise.resolve(null));

                res.on('end', () => {
                    try {
                        expect(res.statusCode).toEqual(StatusCodes.BAD_REQUEST);
                        expect(res._getData()).toContain('User registration not found');
                        done();
                    } catch (err) {
                        reject(err);
                    }
                });

                userRouter(req, res, next);
            }));
        });

        describe('when a generic error occurs', () => {
            it('should re-throw the error', () => new Promise((done, reject) => {
                const req = createRequest({
                    method: 'POST',
                    url: '/current/ciphers',
                    body: { channel: 'email' },
                    session: {
                        displayName,
                        membershipType,
                    },
                });
                const genericError = new Error('Database connection failed');
                let responseEnded = false;
                let errorOccurred = false;

                userService.getUserByDisplayName.mockImplementation(() => Promise.reject(genericError));

                res.on('end', () => {
                    responseEnded = true;
                    if (!errorOccurred) {
                        reject(new Error('Expected error to be thrown, but request completed normally'));
                    }
                });
                setTimeout(() => {
                    if (!responseEnded) {
                        errorOccurred = true;
                        done();
                    }
                }, 50);

                userRouter(req, res, next);
            }));
        });
    });

    describe('POST /users/current/cryptarch', () => {
        const code = '123456';
        const blob = 'email-verification-blob';

        describe('when validating phone verification code', () => {
            it('should validate code and return 204', () => new Promise((done, reject) => {
                const req = createRequest({
                    method: 'POST',
                    url: '/current/cryptarch',
                    body: { channel: 'phone', code },
                    session: {
                        displayName,
                        membershipType,
                    },
                });
                const user = {
                    displayName,
                    membershipType,
                    membership: {
                        tokens: {
                            code,
                            timeStamp: Math.floor(Date.now() / 1000), // Current timestamp
                        },
                    },
                };

                userService.getUserByDisplayName.mockImplementation(() => Promise.resolve(user));

                res.on('end', () => {
                    try {
                        expect(res.statusCode).toEqual(StatusCodes.NO_CONTENT);
                        expect(userService.getUserByDisplayName).toHaveBeenCalledWith(displayName, membershipType);
                        done();
                    } catch (err) {
                        reject(err);
                    }
                });

                userRouter(req, res, next);
            }));
        });

        describe('when validating email verification code', () => {
            it('should validate blob and return 204', () => new Promise((done, reject) => {
                const req = createRequest({
                    method: 'POST',
                    url: '/current/cryptarch',
                    body: { channel: 'email', code: blob },
                    session: {
                        displayName,
                        membershipType,
                    },
                });
                const user = {
                    displayName,
                    membershipType,
                    membership: {
                        tokens: {
                            blob,
                            timeStamp: Math.floor(Date.now() / 1000), // Current timestamp
                        },
                    },
                };

                userService.getUserByDisplayName.mockImplementation(() => Promise.resolve(user));

                res.on('end', () => {
                    try {
                        expect(res.statusCode).toEqual(StatusCodes.NO_CONTENT);
                        expect(userService.getUserByDisplayName).toHaveBeenCalledWith(displayName, membershipType);
                        done();
                    } catch (err) {
                        reject(err);
                    }
                });

                userRouter(req, res, next);
            }));
        });

        describe('when channel is invalid', () => {
            it('should return 400 Bad Request', () => new Promise((done, reject) => {
                const req = createRequest({
                    method: 'POST',
                    url: '/current/cryptarch',
                    body: { channel: 'invalid', code },
                    session: {
                        displayName,
                        membershipType,
                    },
                });

                res.on('end', () => {
                    try {
                        expect(res.statusCode).toEqual(StatusCodes.BAD_REQUEST);
                        expect(res._getData()).toContain('Invalid channel');
                        done();
                    } catch (err) {
                        reject(err);
                    }
                });

                userRouter(req, res, next);
            }));
        });

        describe('when verification code is invalid', () => {
            it('should return 404 Not Found', () => new Promise((done, reject) => {
                const req = createRequest({
                    method: 'POST',
                    url: '/current/cryptarch',
                    body: { channel: 'phone', code: 'wrong-code' },
                    session: {
                        displayName,
                        membershipType,
                    },
                });
                const user = {
                    displayName,
                    membershipType,
                    membership: {
                        tokens: {
                            code: 'correct-code',
                            timeStamp: Math.floor(Date.now() / 1000),
                        },
                    },
                };

                userService.getUserByDisplayName.mockImplementation(() => Promise.resolve(user));

                res.on('end', () => {
                    try {
                        expect(res.statusCode).toEqual(StatusCodes.NOT_FOUND);
                        expect(res._getData()).toContain('Invalid cipher');
                        done();
                    } catch (err) {
                        reject(err);
                    }
                });

                userRouter(req, res, next);
            }));
        });

        describe('when verification code is expired', () => {
            it('should return 404 Not Found', () => new Promise((done, reject) => {
                const req = createRequest({
                    method: 'POST',
                    url: '/current/cryptarch',
                    body: { channel: 'phone', code },
                    session: {
                        displayName,
                        membershipType,
                    },
                });
                const user = {
                    displayName,
                    membershipType,
                    membership: {
                        tokens: {
                            code,
                            timeStamp: Math.floor(Date.now() / 1000) - 400, // Expired (older than 300 seconds TTL)
                        },
                    },
                };

                userService.getUserByDisplayName.mockImplementation(() => Promise.resolve(user));

                res.on('end', () => {
                    try {
                        expect(res.statusCode).toEqual(StatusCodes.NOT_FOUND);
                        expect(res._getData()).toContain('Invalid cipher');
                        done();
                    } catch (err) {
                        reject(err);
                    }
                });

                userRouter(req, res, next);
            }));
        });

        describe('when user is not found', () => {
            it('should return 404 Not Found', () => new Promise((done, reject) => {
                const req = createRequest({
                    method: 'POST',
                    url: '/current/cryptarch',
                    body: { channel: 'phone', code },
                    session: {
                        displayName,
                        membershipType,
                    },
                });

                userService.getUserByDisplayName.mockImplementation(() => Promise.resolve(null));

                res.on('end', () => {
                    try {
                        expect(res.statusCode).toEqual(StatusCodes.NOT_FOUND);
                        expect(res._getData()).toContain('Invalid cipher');
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
