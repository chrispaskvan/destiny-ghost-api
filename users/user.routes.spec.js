import { EventEmitter } from 'node:events';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { StatusCodes } from 'http-status-codes';
import Chance from 'chance';
import { createResponse, createRequest } from 'node-mocks-http';
import UserController from './user.controller.js';
import UserRouter from './user.routes.js';
import UserService from './user.service.js';
import { enqueueResend, enqueueSignUp } from './sign-up.queue.js';

/**
 * Hoisted rather than instance fields so the sign-up tests have a stable
 * handle on them. "Nothing was sent" is half of what rejecting a request
 * means here, and without this there is no way to assert the email side of it.
 */
const { postmasterConfirm, postmasterRegister } = vi.hoisted(() => ({
    postmasterConfirm: vi.fn().mockResolvedValue({ messageId: 'test-email-id' }),
    postmasterRegister: vi.fn().mockResolvedValue({ messageId: 'test-register-id' }),
}));

/**
 * The sign-up log line is the one place the whole user object used to be
 * written out, verification tokens and all, so what it carries is asserted
 * rather than assumed.
 */
const { logInfo, logWarn } = vi.hoisted(() => ({ logInfo: vi.fn(), logWarn: vi.fn() }));

/**
 * The sign-up routes queue their work (#795). Here the queue runs it at
 * once, through the worker `UserController` registered, so these specs still
 * cover a sign-up end to end; the ones that check the route doesn't wait on
 * it override `enqueue…`.
 */
const { queued } = vi.hoisted(() => ({ queued: { work: undefined, serialize: undefined } }));

vi.mock('../helpers/subscriber.js', () => ({
    default: {
        listen: vi.fn((work, queueName) => {
            if (queueName === 'sign-up') {
                queued.work = work;
            }
        }),
    },
}));
vi.mock('./sign-up.queue.js', async () => {
    const { default: safeReviver } = await import('../helpers/safe-reviver.js');

    /** What the worker reads back: the body as the queue writes it to Redis. */
    queued.serialize = data => JSON.parse(JSON.stringify(data), safeReviver);

    return {
        QUEUE_NAME: 'sign-up',
        limitConcurrency: vi.fn().mockResolvedValue(true),
        enqueueSignUp: vi.fn(data => queued.work(queued.serialize(data), {}, { name: 'sign-up' })),
        enqueueResend: vi.fn(data => queued.work(queued.serialize(data), {}, { name: 'resend' })),
    };
});

vi.mock('../helpers/log.js', () => ({
    default: {
        child: vi.fn(bindings => ({ bindings: () => bindings })),
        error: vi.fn(),
        info: logInfo,
        warn: logWarn,
    },
}));
vi.mock('../helpers/postmaster.js', () => ({
    default: class {
        confirm = postmasterConfirm;
        register = postmasterRegister;
    },
}));
vi.mock('../helpers/tokens.js', () => ({
    getBlob: vi.fn(() => 'test-blob-token'),
    getCode: vi.fn(() => '123456'),
}));
vi.mock('../helpers/get-epoch.js', () => ({
    default: vi.fn(() => Math.floor(Temporal.Now.instant().epochMilliseconds / 1000)),
}));

const chance = new Chance();
const displayName = chance.name();
const membershipType = chance.integer({ min: 1, max: 2 });
const csrfToken = chance.guid();
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
    getAccessTokenFromCode: vi.fn(),
    getCurrentUser: vi.fn(),
};
const notificationService = {
    sendMessage: vi.fn(),
};
const userService = {
    createAnonymousUser: vi.fn(),
    getUserByDisplayName: vi.fn(),
    getUserByEmailAddress: vi.fn(),
    getUserByMembershipId: vi.fn(),
    getUserByPhoneNumber: vi.fn(),
    updateAnonymousUser: vi.fn(),
    updateUser: vi.fn(),
};
const worldRepository = {
    getVendorIcon: vi.fn(() => 'https://example.com/icon.png'),
};

const readConsent = vi.fn().mockResolvedValue(undefined);
/** Stand-ins for the per-account limits; their own specs are with the limiter. */
const rateLimiters = {
    signUp: vi.fn((_req, _res, next) => next()),
    resend: vi.fn((_req, _res, next) => next()),
};

let userRouter;

beforeEach(() => {
    userRouter = UserRouter({
        readConsent,
        rateLimiters,
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
            it('should not return a user', () =>
                new Promise((done, reject) => {
                    const req = createRequest({
                        method: 'GET',
                        url: '/current',
                        session: {
                            displayName,
                        },
                    });

                    destinyService.getCurrentUser.mockImplementation(() =>
                        Promise.resolve({
                            displayName: 'l',
                            membershipType: 2,
                            links: [
                                {
                                    rel: 'characters',
                                    href: '/destiny/characters',
                                },
                            ],
                        }),
                    );
                    userService.getUserByDisplayName.mockImplementation(() =>
                        Promise.resolve({
                            bungie: {
                                accessToken: {
                                    value: '11',
                                },
                            },
                        }),
                    );

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
            it('should not return a user', () =>
                new Promise((done, reject) => {
                    const req = createRequest({
                        method: 'GET',
                        url: '/current',
                        session: {
                            membershipType,
                        },
                    });

                    destinyService.getCurrentUser.mockImplementation(() =>
                        Promise.resolve({
                            displayName: 'l',
                            membershipType: 2,
                            links: [
                                {
                                    rel: 'characters',
                                    href: '/destiny/characters',
                                },
                            ],
                        }),
                    );
                    userService.getUserByDisplayName.mockImplementation(() =>
                        Promise.resolve({
                            bungie: {
                                accessToken: {
                                    value: '11',
                                },
                            },
                        }),
                    );

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
                it('should return the current user', () =>
                    new Promise((done, reject) => {
                        const req = createRequest({
                            method: 'GET',
                            url: '/current',
                            session: {
                                csrfToken,
                                displayName,
                                membershipType,
                            },
                        });

                        destinyService.getCurrentUser.mockImplementation(() =>
                            Promise.resolve({
                                links: [
                                    {
                                        rel: 'characters',
                                        href: '/destiny/characters',
                                    },
                                ],
                            }),
                        );
                        userService.getUserByDisplayName.mockImplementation(() =>
                            Promise.resolve({
                                bungie: {
                                    accessToken: {
                                        value: '11',
                                    },
                                },
                                displayName: 'l',
                                membershipType: 2,
                            }),
                        );

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
                it('should not return a user', () =>
                    new Promise((done, reject) => {
                        const req = createRequest({
                            method: 'GET',
                            url: '/current',
                            session: {
                                csrfToken,
                                displayName,
                                membershipType,
                            },
                        });

                        destinyService.getCurrentUser.mockImplementation(() => Promise.resolve());
                        userService.getUserByDisplayName.mockImplementation(() =>
                            Promise.resolve({
                                bungie: {
                                    accessToken: {
                                        value: '11',
                                    },
                                },
                                displayName: 'l',
                                membershipType: 2,
                            }),
                        );

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
                it('should not return a user', () =>
                    new Promise((done, reject) => {
                        const req = createRequest({
                            method: 'GET',
                            url: '/current',
                            session: {
                                csrfToken,
                                displayName,
                                membershipType,
                            },
                        });

                        destinyService.getCurrentUser.mockImplementation(() =>
                            Promise.resolve({
                                displayName: 'l',
                                membershipType: 2,
                                links: [
                                    {
                                        rel: 'characters',
                                        href: '/destiny/characters',
                                    },
                                ],
                            }),
                        );
                        userService.getUserByDisplayName.mockImplementation(() =>
                            Promise.resolve(),
                        );

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

    describe('POST /users/signUp', () => {
        const validBody = {
            firstName: 'Ada',
            lastName: 'Lovelace',
            emailAddress: 'ada@example.com',
            phoneNumber: '+12085550123',
        };

        const signUpEvent = () =>
            logInfo.mock.calls.find(([, message]) => message?.startsWith('User sign'));

        function signUpRequest(body) {
            return createRequest({
                method: 'POST',
                url: '/signUp',
                headers: { 'x-csrf-token': csrfToken },
                session: { csrfToken, displayName: 'test-user', membershipType: 2 },
                body,
            });
        }

        beforeEach(() => {
            userService.getUserByDisplayName.mockResolvedValue(undefined);
            userService.getUserByEmailAddress.mockResolvedValue(undefined);
            userService.getUserByPhoneNumber.mockResolvedValue(undefined);
            userService.updateUser.mockResolvedValue(undefined);
        });

        /**
         * The answer mustn't wait on the work: its latency told a conflict
         * from a sign-up (#795). The account read pends for ever here, so a
         * route that waited on it would never answer.
         */
        it('should answer once the sign-up is queued, before any of it runs', async () => {
            userService.getUserByDisplayName.mockReturnValueOnce(new Promise(() => {}));
            enqueueSignUp.mockImplementationOnce(data => {
                queued.work(queued.serialize(data), {}, { name: 'sign-up' });

                return Promise.resolve({ id: 'job-1' });
            });

            const ended = new Promise(resolve => res.on('end', () => resolve('answered')));

            userRouter(signUpRequest(validBody), res, next);

            await expect(
                Promise.race([ended, new Promise(resolve => setTimeout(resolve, 200, 'waited'))]),
            ).resolves.toBe('answered');
            expect(res.statusCode).toEqual(StatusCodes.NO_CONTENT);
            expect(enqueueSignUp).toHaveBeenCalledExactlyOnceWith({
                displayName: 'test-user',
                membershipType: 2,
                contact: validBody,
            });
            expect(userService.updateUser).not.toHaveBeenCalled();
            expect(notificationService.sendMessage).not.toHaveBeenCalled();
        });

        it('should hand a failed enqueue to the error handler, before any lookup', async () => {
            /** Nothing has been read yet, so the 500 says nothing about the contact. */
            const err = new Error('Redis unavailable');
            const failed = new Promise(resolve => next.mockImplementationOnce(resolve));

            enqueueSignUp.mockRejectedValueOnce(err);
            userRouter(signUpRequest(validBody), res, next);

            await expect(failed).resolves.toBe(err);
            expect(userService.getUserByEmailAddress).not.toHaveBeenCalled();
            expect(userService.getUserByPhoneNumber).not.toHaveBeenCalled();
        });

        it('should queue nothing for a request it rejects', async () => {
            const ended = new Promise(resolve => res.on('end', resolve));

            userRouter(signUpRequest({ ...validBody, phoneNumber: 'nope' }), res, next);
            await ended;

            expect(res.statusCode).toEqual(StatusCodes.UNPROCESSABLE_ENTITY);
            expect(enqueueSignUp).not.toHaveBeenCalled();
        });

        it.each([
            ['notifications', [{ enabled: true, type: 'Xur', messages: [] }]],
            ['dateRegistered', '2020-01-01T00:00:00.000Z'],
            ['isSubscribed', true],
            ['roles', ['Admin']],
        ])(
            'should reject a sign-up carrying %s',
            (field, value) =>
                new Promise((done, reject) => {
                    const req = signUpRequest({ ...validBody, [field]: value });

                    res.on('end', () => {
                        try {
                            expect(res.statusCode).toEqual(StatusCodes.UNPROCESSABLE_ENTITY);
                            /**
                             * Rejected before anything leaves the process: no
                             * document written, no verification SMS, no email. An
                             * enabled notification on an unverified number would
                             * otherwise put it in the next broadcast.
                             */
                            expect(userService.updateUser).not.toHaveBeenCalled();
                            expect(notificationService.sendMessage).not.toHaveBeenCalled();
                            expect(postmasterRegister).not.toHaveBeenCalled();
                            done();
                        } catch (err) {
                            reject(err);
                        }
                    });

                    userRouter(req, res, next);
                }),
        );

        it.each(['firstName', 'lastName', 'emailAddress', 'phoneNumber'])(
            'should reject a sign-up missing %s',
            field =>
                new Promise((done, reject) => {
                    const body = { ...validBody };

                    delete body[field];

                    res.on('end', () => {
                        try {
                            expect(res.statusCode).toEqual(StatusCodes.UNPROCESSABLE_ENTITY);
                            expect(userService.updateUser).not.toHaveBeenCalled();
                            done();
                        } catch (err) {
                            reject(err);
                        }
                    });

                    userRouter(signUpRequest(body), res, next);
                }),
        );

        it('should answer an unusable phone number without a server error', () =>
            new Promise((done, reject) => {
                const req = signUpRequest({ ...validBody, phoneNumber: '+86 10 1234 5678' });

                res.on('end', () => {
                    try {
                        /**
                         * A barred region used to escape `#cleanPhoneNumber` as
                         * a 500 through the global handler.
                         */
                        expect(res.statusCode).toEqual(StatusCodes.UNPROCESSABLE_ENTITY);
                        expect(userService.updateUser).not.toHaveBeenCalled();
                        done();
                    } catch (err) {
                        reject(err);
                    }
                });

                userRouter(req, res, next);
            }));

        it('should accept a sign-up carrying only the allowlisted fields', () =>
            new Promise((done, reject) => {
                res.on('end', () => {
                    try {
                        expect(res.statusCode).toEqual(StatusCodes.NO_CONTENT);
                        /** Unregistered, so written without top-level contact. */
                        expect(userService.updateAnonymousUser).toHaveBeenCalled();
                        expect(postmasterRegister).toHaveBeenCalled();
                        done();
                    } catch (err) {
                        reject(err);
                    }
                });

                userRouter(signUpRequest({ ...validBody }), res, next);
            }));

        it('should answer 204 even when a verification message did not go out', () =>
            new Promise((done, reject) => {
                notificationService.sendMessage.mockRejectedValueOnce(new Error('twilio'));

                res.on('end', () => {
                    try {
                        /**
                         * The same answer as a conflict, which sends nothing: a
                         * caller can make the SMS fail at will (a number that
                         * texted STOP), so a different answer here would tell
                         * them whether the email address is registered.
                         */
                        expect(res.statusCode).toEqual(StatusCodes.NO_CONTENT);
                        expect(res._getData()).toEqual('');
                        expect(logWarn).toHaveBeenCalledWith(
                            { displayName: 'test-user', membershipType: 2, undelivered: ['phone'] },
                            'User signed up, but not every verification message was sent',
                        );
                        expect(signUpEvent()).toBeUndefined();
                        done();
                    } catch (err) {
                        reject(err);
                    }
                });

                userRouter(signUpRequest({ ...validBody }), res, next);
            }));

        it('should log a successful sign-up without the tokens it just minted', () =>
            new Promise((done, reject) => {
                res.on('end', () => {
                    try {
                        const [event, message] = signUpEvent();

                        expect(message).toEqual('User signed up');
                        expect(event).toEqual({
                            displayName: 'test-user',
                            membershipType: 2,
                        });
                        /**
                         * `getBlob`/`getCode` are stubbed at the top of this
                         * file, so these are the exact values `signUp` put on
                         * the document it returned.
                         */
                        expect(JSON.stringify(event)).not.toContain('test-blob-token');
                        expect(JSON.stringify(event)).not.toContain('123456');
                        expect(JSON.stringify(event)).not.toContain(validBody.emailAddress);
                        done();
                    } catch (err) {
                        reject(err);
                    }
                });

                userRouter(signUpRequest({ ...validBody }), res, next);
            }));

        it('should log a failed sign-up as an outcome rather than a document', () =>
            new Promise((done, reject) => {
                userService.getUserByPhoneNumber.mockResolvedValue({
                    dateRegistered: '2020-01-01T00:00:00.000Z',
                    bungie: { access_token: 'sentinel-access-token' },
                });

                res.on('end', () => {
                    try {
                        const [event, message] = signUpEvent();

                        expect(message).toEqual('User sign up failed due to conflicts');
                        expect(event).toEqual({
                            displayName: 'test-user',
                            membershipType: 2,
                        });
                        expect(JSON.stringify(event)).not.toContain('sentinel-access-token');
                        done();
                    } catch (err) {
                        reject(err);
                    }
                });

                userRouter(signUpRequest({ ...validBody }), res, next);
            }));

        it('should not disclose that an address is already registered', () =>
            new Promise((done, reject) => {
                userService.getUserByEmailAddress.mockResolvedValue({
                    dateRegistered: '2020-01-01T00:00:00.000Z',
                });

                res.on('end', () => {
                    try {
                        /**
                         * Same 204 as a successful sign-up, and nothing sent -
                         * the conflict must stay invisible to the caller.
                         */
                        expect(res.statusCode).toEqual(StatusCodes.NO_CONTENT);
                        expect(userService.updateUser).not.toHaveBeenCalled();
                        expect(userService.updateAnonymousUser).not.toHaveBeenCalled();
                        expect(notificationService.sendMessage).not.toHaveBeenCalled();
                        expect(postmasterRegister).not.toHaveBeenCalled();
                        done();
                    } catch (err) {
                        reject(err);
                    }
                });

                userRouter(signUpRequest({ ...validBody }), res, next);
            }));
    });

    describe('PATCH /users', () => {
        describe('when If-Match header is not defined', () => {
            it('should return precondition failed', () =>
                new Promise((done, reject) => {
                    const req = createRequest({
                        method: 'PATCH',
                        url: '/',
                        headers: { 'x-csrf-token': csrfToken },
                        session: { csrfToken },
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
            it('should not return a user', () =>
                new Promise((done, reject) => {
                    const req = createRequest({
                        headers: {
                            'if-match': '02',
                            'x-csrf-token': csrfToken,
                        },
                        method: 'PATCH',
                        url: '/',
                        session: { csrfToken },
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
                it('should patch the user', () =>
                    new Promise((done, reject) => {
                        const req = createRequest({
                            headers: {
                                'if-match': ETag,
                                'x-csrf-token': csrfToken,
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
                                csrfToken,
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

                        userService.getUserByDisplayName.mockImplementation(() =>
                            Promise.resolve(user),
                        );

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

                it('should return unprocessable entity when a patch operation cannot be applied', () =>
                    new Promise((done, reject) => {
                        const req = createRequest({
                            headers: {
                                'if-match': ETag,
                                'x-csrf-token': csrfToken,
                            },
                            method: 'PATCH',
                            url: '/',
                            body: [
                                {
                                    op: 'replace',
                                    path: '/notifications/5/enabled',
                                    value: true,
                                },
                            ],
                            session: {
                                csrfToken,
                                displayName,
                                membershipType,
                            },
                        });
                        const user = {
                            _etag: ETag,
                            displayName,
                            membershipType,
                            notifications: [{ enabled: false, type: 'Xur', messages: [] }],
                        };

                        userService.getUserByDisplayName.mockImplementation(() =>
                            Promise.resolve(user),
                        );
                        userService.updateUser.mockClear();

                        res.on('end', () => {
                            try {
                                expect(res.statusCode).toEqual(StatusCodes.UNPROCESSABLE_ENTITY);
                                expect(userService.updateUser).not.toHaveBeenCalled();
                                done();
                            } catch (err) {
                                reject(err);
                            }
                        });

                        userRouter(req, res, next);
                    }));
            });
            describe('when ETag does not match', () => {
                it('should return precondition failed', () =>
                    new Promise((done, reject) => {
                        const req = createRequest({
                            headers: {
                                'if-match': ETag,
                                'x-csrf-token': csrfToken,
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
                                csrfToken,
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

                        userService.getUserByDisplayName.mockImplementation(() =>
                            Promise.resolve(user),
                        );

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

            describe('when the CSRF token is missing or invalid', () => {
                it('should forward an invalid csrf token error instead of patching the user', async () => {
                    const req = createRequest({
                        headers: {
                            'if-match': ETag,
                            'x-csrf-token': 'wrong-token',
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
                            csrfToken,
                            displayName,
                            membershipType,
                        },
                    });

                    next.mockClear();
                    userService.updateUser.mockClear();

                    userRouter(req, res, next);

                    await vi.waitFor(() => {
                        expect(next).toHaveBeenCalledWith(
                            expect.objectContaining({ statusCode: StatusCodes.FORBIDDEN }),
                        );
                    });

                    expect(userService.updateUser).not.toHaveBeenCalled();
                    expect(res._isEndCalled()).toEqual(false);
                });
            });

            describe('when a generic error occurs', () => {
                it('should re-throw the error', () =>
                    new Promise((done, reject) => {
                        const req = createRequest({
                            headers: {
                                'if-match': ETag,
                                'x-csrf-token': csrfToken,
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
                                csrfToken,
                                displayName,
                                membershipType,
                            },
                        });
                        const genericError = new Error('Database connection failed');
                        let responseEnded = false;
                        let errorOccurred = false;

                        userService.getUserByDisplayName.mockImplementation(() =>
                            Promise.reject(genericError),
                        );

                        res.on('end', () => {
                            responseEnded = true;
                            if (!errorOccurred) {
                                reject(
                                    new Error(
                                        'Expected error to be thrown, but request completed normally',
                                    ),
                                );
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

        describe('through the real UserService', () => {
            /**
             * The tests above stub `userService`, so the ETag a client is
             * handed never comes from the cache that `updateUser` refreshes.
             * This wires a real `UserService` over an in-memory Cosmos that
             * enforces IfMatch and an in-memory cache, so the profile read
             * returns whatever the previous write left behind - which, before
             * the cache held the document Cosmos returned, was a superseded
             * etag.
             */
            function wireRouter() {
                let stored = {
                    _etag: 'etag-1',
                    bungie: { access_token: 'access-token' },
                    displayName,
                    emailAddress: 'guardian@example.com',
                    firstName: 'zero',
                    id: 'user-1',
                    lastName: 'last',
                    membershipId: '11',
                    membershipType,
                    phoneNumber: '+15555550100',
                };
                let cached;
                const documentService = {
                    getDocuments: vi.fn(async () => [structuredClone(stored)]),
                    updateDocument: vi.fn(async (_collection, document) => {
                        if (document._etag !== stored._etag) {
                            throw Object.assign(new Error('precondition failed'), { code: 412 });
                        }

                        stored = { ...structuredClone(document), _etag: `${stored._etag}+1` };

                        return structuredClone(stored);
                    }),
                };
                const cacheService = {
                    getUser: vi.fn(async () => cached && structuredClone(cached)),
                    setUser: vi.fn(async document => {
                        cached = structuredClone(document);
                    }),
                };
                const router = UserRouter({
                    readConsent,
                    rateLimiters,
                    authenticationController,
                    destinyService,
                    notificationService,
                    userService: new UserService({ cacheService, client: {}, documentService }),
                    worldRepository,
                });

                return { documentService, router };
            }

            function send(router, { body, headers, method, url }) {
                const response = createResponse({ eventEmitter: EventEmitter });
                const request = createRequest({
                    body,
                    headers: { 'x-csrf-token': csrfToken, ...headers },
                    method,
                    url,
                    session: { csrfToken, displayName, membershipType },
                });

                return new Promise((resolve, reject) => {
                    response.on('end', () => resolve(response));
                    Promise.resolve(router(request, response, reject)).catch(reject);
                });
            }

            function patchFirstName(router, ETag, value) {
                return send(router, {
                    body: [{ op: 'replace', path: '/firstName', value }],
                    headers: { 'if-match': ETag },
                    method: 'PATCH',
                    url: '/',
                });
            }

            beforeEach(() => {
                destinyService.getCurrentUser.mockResolvedValue({ displayName, membershipType });
            });

            it('accepts a PATCH that uses the ETag the profile returned after a PATCH', async () => {
                const { documentService, router } = wireRouter();

                const first = await patchFirstName(router, 'etag-1', 'first');
                const profile = await send(router, { method: 'GET', url: '/current' });
                const second = await patchFirstName(router, profile.getHeader('ETag'), 'second');

                expect(first.statusCode).toEqual(StatusCodes.NO_CONTENT);
                expect(profile.statusCode).toEqual(StatusCodes.OK);
                expect(profile.getHeader('ETag')).toEqual('etag-1+1');
                expect(second.statusCode).toEqual(StatusCodes.NO_CONTENT);
                expect(documentService.updateDocument).toHaveBeenLastCalledWith(
                    expect.anything(),
                    expect.objectContaining({ _etag: 'etag-1+1', firstName: 'second' }),
                    membershipType,
                );
            });

            it('still rejects a writer holding an ETag another write superseded', async () => {
                const { documentService, router } = wireRouter();

                await patchFirstName(router, 'etag-1', 'first');
                const stale = await patchFirstName(router, 'etag-1', 'stale');

                expect(stale.statusCode).toEqual(StatusCodes.PRECONDITION_FAILED);
                expect(documentService.updateDocument).toHaveBeenCalledOnce();
            });
        });
    });

    describe('POST /users/join', () => {
        it("should join the session's own account", async () => {
            const joinSpy = vi.spyOn(UserController.prototype, 'join').mockResolvedValueOnce({});
            const done = new Promise(resolve => res.on('end', resolve));

            /** Built after the spy, so its controller calls through it. */
            UserRouter({
                readConsent,
                rateLimiters,
                authenticationController,
                destinyService,
                notificationService,
                userService,
                worldRepository,
            })(
                createRequest({
                    method: 'POST',
                    url: '/join',
                    headers: { 'x-csrf-token': csrfToken },
                    session: { csrfToken, displayName, membershipType },
                    body: {
                        displayName: 'someone-else',
                        tokens: { emailAddress: 'blob', phoneNumber: '424242' },
                    },
                }),
                res,
                next,
            );
            await done;

            /** The account comes from the session, never the body. */
            expect(joinSpy).toHaveBeenCalledExactlyOnceWith({
                displayName,
                membershipType,
                tokens: { emailAddress: 'blob', phoneNumber: '424242' },
            });
            expect(res.statusCode).toEqual(StatusCodes.OK);
            joinSpy.mockRestore();
        });
    });

    describe('POST /users/signUp/resend', () => {
        const session = { csrfToken, displayName, membershipType, membershipId: 'm-1' };
        const resendRequest = body =>
            createRequest({
                method: 'POST',
                url: '/signUp/resend',
                headers: { 'x-csrf-token': csrfToken },
                session,
                body,
            });
        const ended = () => new Promise(resolve => res.on('end', resolve));

        beforeEach(() => {
            userService.updateUser.mockResolvedValue(undefined);
        });

        it('should answer once the resend is queued, before any of it runs', async () => {
            /** A resend after a conflict found nothing and returned at once (#795). */
            userService.getUserByDisplayName.mockReturnValueOnce(new Promise(() => {}));
            enqueueResend.mockImplementationOnce(data => {
                queued.work(queued.serialize(data), {}, { name: 'resend' });

                return Promise.resolve({ id: 'job-1' });
            });

            const answered = ended().then(() => 'answered');

            userRouter(resendRequest({ channel: 'phone' }), res, next);

            await expect(
                Promise.race([
                    answered,
                    new Promise(resolve => setTimeout(resolve, 200, 'waited')),
                ]),
            ).resolves.toBe('answered');
            expect(res.statusCode).toEqual(StatusCodes.NO_CONTENT);
            expect(enqueueResend).toHaveBeenCalledExactlyOnceWith({
                displayName,
                membershipType,
                channel: 'phone',
            });
            expect(notificationService.sendMessage).not.toHaveBeenCalled();
        });

        it.each([
            [
                'there is no pending sign-up',
                () => userService.getUserByDisplayName.mockResolvedValue(undefined),
            ],
            [
                'the resend goes out',
                () =>
                    userService.getUserByDisplayName.mockResolvedValue({
                        displayName,
                        membershipType,
                        phoneNumber: '+15555550100',
                        membership: {
                            tokens: {
                                blob: 'b',
                                code: '424242',
                                timeStamp: Number.MAX_SAFE_INTEGER,
                            },
                        },
                    }),
            ],
            [
                'the send fails',
                () => {
                    userService.getUserByDisplayName.mockResolvedValue({
                        displayName,
                        membershipType,
                        phoneNumber: '+15555550100',
                        membership: {
                            tokens: {
                                blob: 'b',
                                code: '424242',
                                timeStamp: Number.MAX_SAFE_INTEGER,
                            },
                        },
                    });
                    notificationService.sendMessage.mockRejectedValueOnce(new Error('21610'));
                },
            ],
        ])('should answer 204 when %s', async (_, arrange) => {
            arrange();

            const done = ended();

            userRouter(resendRequest({ channel: 'phone' }), res, next);
            await done;

            /**
             * The same answer every time: whether a sign-up was saved is what
             * the conflict check decided, and a send can be made to fail.
             */
            expect(res.statusCode).toEqual(StatusCodes.NO_CONTENT);
            expect(res._getData()).toEqual('');
        });

        it.each([undefined, 'sms', 'Phone'])(
            'should reject channel %j before spending the limit',
            async channel => {
                const done = ended();

                userRouter(resendRequest({ channel }), res, next);
                await done;

                expect(res.statusCode).toEqual(StatusCodes.BAD_REQUEST);
                expect(rateLimiters.resend).not.toHaveBeenCalled();
                expect(userService.getUserByDisplayName).not.toHaveBeenCalled();
            },
        );

        it('should stop at the resend limit before reading or sending', async () => {
            rateLimiters.resend.mockImplementationOnce((_req, limited) =>
                limited.status(StatusCodes.TOO_MANY_REQUESTS).end(),
            );

            const done = ended();

            userRouter(resendRequest({ channel: 'email' }), res, next);
            await done;

            expect(res.statusCode).toEqual(StatusCodes.TOO_MANY_REQUESTS);
            expect(userService.getUserByDisplayName).not.toHaveBeenCalled();
            expect(postmasterRegister).not.toHaveBeenCalled();
        });

        it('should forward a bad CSRF token without spending the limit', async () => {
            next.mockClear();

            userRouter(
                createRequest({
                    method: 'POST',
                    url: '/signUp/resend',
                    headers: { 'x-csrf-token': 'wrong-token' },
                    session,
                    body: { channel: 'phone' },
                }),
                res,
                next,
            );

            await vi.waitFor(() => {
                expect(next).toHaveBeenCalledWith(
                    expect.objectContaining({ statusCode: StatusCodes.FORBIDDEN }),
                );
            });
            expect(rateLimiters.resend).not.toHaveBeenCalled();
        });
    });

    describe('POST /users/signUp rate limit', () => {
        it.each([
            ['an unusable phone number', { phoneNumber: '+86 10 1234 5678' }],
            ['a missing field', { lastName: undefined }],
        ])('should answer 422 for %s without spending the limit', async (_, change) => {
            const done = new Promise(resolve => res.on('end', resolve));

            userRouter(
                createRequest({
                    method: 'POST',
                    url: '/signUp',
                    headers: { 'x-csrf-token': csrfToken },
                    session: { csrfToken, displayName, membershipType },
                    body: {
                        firstName: 'Ada',
                        lastName: 'Lovelace',
                        phoneNumber: '+12085550123',
                        emailAddress: 'ada@example.com',
                        ...change,
                    },
                }),
                res,
                next,
            );
            await done;

            expect(res.statusCode).toEqual(StatusCodes.UNPROCESSABLE_ENTITY);
            expect(rateLimiters.signUp).not.toHaveBeenCalled();
        });

        it('should stop at the sign-up limit before reading, saving or sending', async () => {
            rateLimiters.signUp.mockImplementationOnce((_req, limited) =>
                limited.status(StatusCodes.TOO_MANY_REQUESTS).end(),
            );

            const done = new Promise(resolve => res.on('end', resolve));

            userRouter(
                createRequest({
                    method: 'POST',
                    url: '/signUp',
                    headers: { 'x-csrf-token': csrfToken },
                    session: { csrfToken, displayName, membershipType, membershipId: 'm-1' },
                    body: {
                        firstName: 'Ada',
                        lastName: 'Lovelace',
                        phoneNumber: '+12085550123',
                        emailAddress: 'ada@example.com',
                    },
                }),
                res,
                next,
            );
            await done;

            expect(res.statusCode).toEqual(StatusCodes.TOO_MANY_REQUESTS);
            expect(rateLimiters.signUp).toHaveBeenCalledOnce();
            expect(userService.getUserByDisplayName).not.toHaveBeenCalled();
            expect(userService.updateUser).not.toHaveBeenCalled();
            expect(notificationService.sendMessage).not.toHaveBeenCalled();
        });
    });

    describe('retired verification codes (#799)', () => {
        it.each(['/current/ciphers', '/current/cryptarch'])(
            'should leave POST %s unrouted, so it answers 404',
            async url => {
                const passed = new Promise(resolve => next.mockImplementationOnce(resolve));

                userRouter(
                    createRequest({
                        method: 'POST',
                        url,
                        headers: { 'x-csrf-token': csrfToken },
                        session: { csrfToken, displayName, membershipType, membershipId: 'm-1' },
                        body: { channel: 'phone', code: '123456' },
                    }),
                    res,
                    next,
                );

                /** Passed on with no error: the app's own 404 answers it. */
                await expect(passed).resolves.toBeUndefined();
                expect(userService.getUserByDisplayName).not.toHaveBeenCalled();
                expect(notificationService.sendMessage).not.toHaveBeenCalled();
            },
        );
    });

    describe('GET /users/current/csrfToken', () => {
        describe('when the session is authenticated', () => {
            it('should mint and return a CSRF token', () =>
                new Promise((done, reject) => {
                    const req = createRequest({
                        method: 'GET',
                        url: '/current/csrfToken',
                        session: {
                            displayName,
                            membershipType,
                        },
                    });

                    res.on('end', () => {
                        try {
                            expect(res.statusCode).toEqual(StatusCodes.OK);
                            expect(JSON.parse(res._getData())).toEqual({
                                csrfToken: req.session.csrfToken,
                            });
                            expect(typeof req.session.csrfToken).toEqual('string');
                            expect(res.getHeader('Cache-Control')).toEqual('no-store');
                            done();
                        } catch (err) {
                            reject(err);
                        }
                    });

                    userRouter(req, res, next);
                }));
        });
    });

    describe('GET /users/signIn/Bungie', () => {
        const queryState = 'test-state-value';

        describe('when user is already authenticated (displayName in session)', () => {
            it('should redirect a browser client to the website', () =>
                new Promise((done, reject) => {
                    const req = createRequest({
                        method: 'GET',
                        url: '/signIn/Bungie',
                        headers: { accept: 'text/html' },
                        query: { code: 'oauth-code', state: queryState },
                        session: { displayName, state: queryState },
                    });

                    res.on('end', () => {
                        try {
                            expect(res.statusCode).toEqual(StatusCodes.MOVED_TEMPORARILY);
                            expect(res._getRedirectUrl()).toContain('auth=success');
                            done();
                        } catch (err) {
                            reject(err);
                        }
                    });

                    userRouter(req, res, next);
                }));

            it('should return JSON to an API client', () =>
                new Promise((done, reject) => {
                    const req = createRequest({
                        method: 'GET',
                        url: '/signIn/Bungie',
                        headers: { accept: 'application/json' },
                        query: { code: 'oauth-code', state: queryState },
                        session: { displayName, state: queryState },
                    });

                    res.on('end', () => {
                        try {
                            expect(res.statusCode).toEqual(StatusCodes.OK);
                            expect(JSON.parse(res._getData())).toEqual({ displayName });
                            done();
                        } catch (err) {
                            reject(err);
                        }
                    });

                    userRouter(req, res, next);
                }));
        });

        describe('when state does not match', () => {
            it('should redirect a browser client with an error', () =>
                new Promise((done, reject) => {
                    const req = createRequest({
                        method: 'GET',
                        url: '/signIn/Bungie',
                        headers: { accept: 'text/html' },
                        query: { code: 'oauth-code', state: 'different-state' },
                        session: { state: queryState },
                    });

                    res.on('end', () => {
                        try {
                            expect(res.statusCode).toEqual(StatusCodes.MOVED_TEMPORARILY);
                            expect(res._getRedirectUrl()).toContain('error=unauthorized');
                            done();
                        } catch (err) {
                            reject(err);
                        }
                    });

                    userRouter(req, res, next);
                }));

            it('should return 401 to an API client', () =>
                new Promise((done, reject) => {
                    const req = createRequest({
                        method: 'GET',
                        url: '/signIn/Bungie',
                        headers: { accept: 'application/json' },
                        query: { code: 'oauth-code', state: 'different-state' },
                        session: { state: queryState },
                    });

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

        describe('when the session never established a state (both state values are undefined)', () => {
            it('should redirect a browser client with an error', () =>
                new Promise((done, reject) => {
                    const req = createRequest({
                        method: 'GET',
                        url: '/signIn/Bungie',
                        headers: { accept: 'text/html' },
                        query: { code: 'oauth-code' },
                        session: {},
                    });

                    res.on('end', () => {
                        try {
                            expect(res.statusCode).toEqual(StatusCodes.MOVED_TEMPORARILY);
                            expect(res._getRedirectUrl()).toContain('error=unauthorized');
                            expect(destinyService.getAccessTokenFromCode).not.toHaveBeenCalled();
                            done();
                        } catch (err) {
                            reject(err);
                        }
                    });

                    userRouter(req, res, next);
                }));

            it('should return 401 to an API client', () =>
                new Promise((done, reject) => {
                    const req = createRequest({
                        method: 'GET',
                        url: '/signIn/Bungie',
                        headers: { accept: 'application/json' },
                        query: { code: 'oauth-code' },
                        session: {},
                    });

                    res.on('end', () => {
                        try {
                            expect(res.statusCode).toEqual(StatusCodes.UNAUTHORIZED);
                            expect(destinyService.getAccessTokenFromCode).not.toHaveBeenCalled();
                            done();
                        } catch (err) {
                            reject(err);
                        }
                    });

                    userRouter(req, res, next);
                }));
        });

        describe('when code is missing', () => {
            it('should redirect a browser client with an error', () =>
                new Promise((done, reject) => {
                    const req = createRequest({
                        method: 'GET',
                        url: '/signIn/Bungie',
                        headers: { accept: 'text/html' },
                        query: { state: queryState },
                        session: { state: queryState },
                    });

                    res.on('end', () => {
                        try {
                            expect(res.statusCode).toEqual(StatusCodes.MOVED_TEMPORARILY);
                            expect(res._getRedirectUrl()).toContain('error=unauthorized');
                            expect(destinyService.getAccessTokenFromCode).not.toHaveBeenCalled();
                            done();
                        } catch (err) {
                            reject(err);
                        }
                    });

                    userRouter(req, res, next);
                }));

            it('should return 401 to an API client', () =>
                new Promise((done, reject) => {
                    const req = createRequest({
                        method: 'GET',
                        url: '/signIn/Bungie',
                        headers: { accept: 'application/json' },
                        query: { state: queryState },
                        session: { state: queryState },
                    });

                    res.on('end', () => {
                        try {
                            expect(res.statusCode).toEqual(StatusCodes.UNAUTHORIZED);
                            expect(destinyService.getAccessTokenFromCode).not.toHaveBeenCalled();
                            done();
                        } catch (err) {
                            reject(err);
                        }
                    });

                    userRouter(req, res, next);
                }));
        });

        describe('when userController.signIn returns undefined (user not found)', () => {
            beforeEach(() => {
                destinyService.getAccessTokenFromCode.mockResolvedValue({ access_token: 'token' });
                destinyService.getCurrentUser.mockResolvedValue(undefined);
            });

            it('should redirect a browser client with an auth_failed error', () =>
                new Promise((done, reject) => {
                    const req = createRequest({
                        method: 'GET',
                        url: '/signIn/Bungie',
                        headers: { accept: 'text/html' },
                        query: { code: 'oauth-code', state: queryState },
                        session: { state: queryState },
                    });

                    res.on('end', () => {
                        try {
                            expect(res.statusCode).toEqual(StatusCodes.MOVED_TEMPORARILY);
                            expect(res._getRedirectUrl()).toContain('error=auth_failed');
                            done();
                        } catch (err) {
                            reject(err);
                        }
                    });

                    userRouter(req, res, next);
                }));

            it('should return 404 to an API client', () =>
                new Promise((done, reject) => {
                    const req = createRequest({
                        method: 'GET',
                        url: '/signIn/Bungie',
                        headers: { accept: 'application/json' },
                        query: { code: 'oauth-code', state: queryState },
                        session: { state: queryState },
                    });

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

        describe('when sign-in succeeds', () => {
            const bungieUser = {
                displayName,
                membershipId: 'membership-123',
                membershipType,
                profilePicturePath: '/path/to/pic',
            };

            beforeEach(() => {
                destinyService.getAccessTokenFromCode.mockResolvedValue({ access_token: 'token' });
                destinyService.getCurrentUser.mockResolvedValue(bungieUser);
                userService.getUserByMembershipId.mockResolvedValue({
                    ...bungieUser,
                    dateRegistered: Temporal.Now.instant().toString(),
                });
                userService.updateUser.mockResolvedValue(bungieUser);
            });

            it('should redirect a browser client to the website on success', () =>
                new Promise((done, reject) => {
                    const req = createRequest({
                        method: 'GET',
                        url: '/signIn/Bungie',
                        headers: { accept: 'text/html' },
                        query: { code: 'oauth-code', state: queryState },
                        session: {
                            state: queryState,
                            regenerate: vi.fn(cb => {
                                cb(null);
                            }),
                        },
                    });

                    res.on('end', () => {
                        try {
                            expect(res.statusCode).toEqual(StatusCodes.MOVED_TEMPORARILY);
                            expect(res._getRedirectUrl()).toContain('auth=success');
                            done();
                        } catch (err) {
                            reject(err);
                        }
                    });

                    userRouter(req, res, next);
                }));

            it('should return JSON with displayName to an API client on success', () =>
                new Promise((done, reject) => {
                    const req = createRequest({
                        method: 'GET',
                        url: '/signIn/Bungie',
                        headers: { accept: 'application/json' },
                        query: { code: 'oauth-code', state: queryState },
                        session: {
                            state: queryState,
                            regenerate: vi.fn(cb => {
                                cb(null);
                            }),
                        },
                    });

                    res.on('end', () => {
                        try {
                            expect(res.statusCode).toEqual(StatusCodes.OK);
                            expect(JSON.parse(res._getData())).toEqual({ displayName });
                            done();
                        } catch (err) {
                            reject(err);
                        }
                    });

                    userRouter(req, res, next);
                }));

            it('should return JSON to an API client with Accept: */* (not redirect)', () =>
                new Promise((done, reject) => {
                    const req = createRequest({
                        method: 'GET',
                        url: '/signIn/Bungie',
                        headers: { accept: '*/*' },
                        query: { code: 'oauth-code', state: queryState },
                        session: {
                            state: queryState,
                            regenerate: vi.fn(cb => {
                                cb(null);
                            }),
                        },
                    });

                    res.on('end', () => {
                        try {
                            expect(res.statusCode).toEqual(StatusCodes.OK);
                            expect(JSON.parse(res._getData())).toEqual({ displayName });
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
