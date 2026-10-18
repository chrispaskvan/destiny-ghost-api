import { EventEmitter } from 'node:events';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { StatusCodes } from 'http-status-codes';
import Chance from 'chance';
import { createResponse, createRequest } from 'node-mocks-http';
import UserRouter from './user.routes.js';
import UserService from './user.service.js';

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
const { logInfo } = vi.hoisted(() => ({ logInfo: vi.fn() }));

vi.mock('../helpers/log.js', () => ({
    default: { error: vi.fn(), info: logInfo, warn: vi.fn() },
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
                        expect(userService.updateUser).toHaveBeenCalled();
                        expect(postmasterRegister).toHaveBeenCalled();
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

    describe('POST /users/current/ciphers', () => {
        const phoneNumber = '+1234567890';
        const emailAddress = 'test@example.com';

        describe('when channel is email', () => {
            it('should send verification code and return 202', () =>
                new Promise((done, reject) => {
                    const req = createRequest({
                        method: 'POST',
                        url: '/current/ciphers',
                        headers: { 'x-csrf-token': csrfToken },
                        body: { channel: 'email' },
                        session: {
                            csrfToken,
                            displayName,
                            membershipType,
                        },
                    });
                    const user = {
                        displayName,
                        membershipType,
                        dateRegistered: Temporal.Now.instant().toString(),
                        emailAddress,
                        phoneNumber,
                    };

                    userService.getUserByDisplayName.mockImplementation(() =>
                        Promise.resolve(user),
                    );
                    userService.updateUser.mockImplementation(() => Promise.resolve(user));

                    res.on('end', () => {
                        try {
                            expect(res.statusCode).toEqual(StatusCodes.ACCEPTED);
                            expect(userService.getUserByDisplayName).toHaveBeenCalledWith(
                                displayName,
                                membershipType,
                            );
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
            it('should send verification code and return 202', () =>
                new Promise((done, reject) => {
                    const req = createRequest({
                        method: 'POST',
                        url: '/current/ciphers',
                        headers: { 'x-csrf-token': csrfToken },
                        body: { channel: 'phone' },
                        session: {
                            csrfToken,
                            displayName,
                            membershipType,
                        },
                    });
                    const user = {
                        displayName,
                        membershipType,
                        dateRegistered: Temporal.Now.instant().toString(),
                        emailAddress,
                        phoneNumber,
                    };

                    userService.getUserByDisplayName.mockImplementation(() =>
                        Promise.resolve(user),
                    );
                    userService.updateUser.mockImplementation(() => Promise.resolve(user));
                    notificationService.sendMessage.mockImplementation(() =>
                        Promise.resolve({ sid: 'test-message-id' }),
                    );

                    res.on('end', () => {
                        try {
                            expect(res.statusCode).toEqual(StatusCodes.ACCEPTED);
                            expect(userService.getUserByDisplayName).toHaveBeenCalledWith(
                                displayName,
                                membershipType,
                            );
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
            it('should return 400 Bad Request', () =>
                new Promise((done, reject) => {
                    const req = createRequest({
                        method: 'POST',
                        url: '/current/ciphers',
                        headers: { 'x-csrf-token': csrfToken },
                        body: { channel: 'invalid' },
                        session: {
                            csrfToken,
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
            it('should return 400 Bad Request', () =>
                new Promise((done, reject) => {
                    const req = createRequest({
                        method: 'POST',
                        url: '/current/ciphers',
                        headers: { 'x-csrf-token': csrfToken },
                        body: {},
                        session: {
                            csrfToken,
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
            it('should return 400 Bad Request', () =>
                new Promise((done, reject) => {
                    const req = createRequest({
                        method: 'POST',
                        url: '/current/ciphers',
                        headers: { 'x-csrf-token': csrfToken },
                        body: { channel: 'email' },
                        session: {
                            csrfToken,
                            displayName,
                            membershipType,
                        },
                    });

                    userService.getUserByDisplayName.mockImplementation(() =>
                        Promise.resolve(null),
                    );

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
            it('should re-throw the error', () =>
                new Promise((done, reject) => {
                    const req = createRequest({
                        method: 'POST',
                        url: '/current/ciphers',
                        headers: { 'x-csrf-token': csrfToken },
                        body: { channel: 'email' },
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

    describe('POST /users/current/cryptarch', () => {
        const code = '123456';
        const blob = 'email-verification-blob';

        describe('when validating phone verification code', () => {
            it('should validate code and return 204', () =>
                new Promise((done, reject) => {
                    const req = createRequest({
                        method: 'POST',
                        url: '/current/cryptarch',
                        headers: { 'x-csrf-token': csrfToken },
                        body: { channel: 'phone', code },
                        session: {
                            csrfToken,
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
                                timeStamp: Math.floor(
                                    Temporal.Now.instant().epochMilliseconds / 1000,
                                ), // Current timestamp
                            },
                        },
                    };

                    userService.getUserByDisplayName.mockImplementation(() =>
                        Promise.resolve(user),
                    );

                    res.on('end', () => {
                        try {
                            expect(res.statusCode).toEqual(StatusCodes.NO_CONTENT);
                            expect(userService.getUserByDisplayName).toHaveBeenCalledWith(
                                displayName,
                                membershipType,
                            );
                            done();
                        } catch (err) {
                            reject(err);
                        }
                    });

                    userRouter(req, res, next);
                }));
        });

        describe('when validating email verification code', () => {
            it('should validate blob and return 204', () =>
                new Promise((done, reject) => {
                    const req = createRequest({
                        method: 'POST',
                        url: '/current/cryptarch',
                        headers: { 'x-csrf-token': csrfToken },
                        body: { channel: 'email', code: blob },
                        session: {
                            csrfToken,
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
                                timeStamp: Math.floor(
                                    Temporal.Now.instant().epochMilliseconds / 1000,
                                ), // Current timestamp
                            },
                        },
                    };

                    userService.getUserByDisplayName.mockImplementation(() =>
                        Promise.resolve(user),
                    );

                    res.on('end', () => {
                        try {
                            expect(res.statusCode).toEqual(StatusCodes.NO_CONTENT);
                            expect(userService.getUserByDisplayName).toHaveBeenCalledWith(
                                displayName,
                                membershipType,
                            );
                            done();
                        } catch (err) {
                            reject(err);
                        }
                    });

                    userRouter(req, res, next);
                }));
        });

        describe('when channel is invalid', () => {
            it('should return 400 Bad Request', () =>
                new Promise((done, reject) => {
                    const req = createRequest({
                        method: 'POST',
                        url: '/current/cryptarch',
                        headers: { 'x-csrf-token': csrfToken },
                        body: { channel: 'invalid', code },
                        session: {
                            csrfToken,
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
            it('should return 404 Not Found', () =>
                new Promise((done, reject) => {
                    const req = createRequest({
                        method: 'POST',
                        url: '/current/cryptarch',
                        headers: { 'x-csrf-token': csrfToken },
                        body: { channel: 'phone', code: 'wrong-code' },
                        session: {
                            csrfToken,
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
                                timeStamp: Math.floor(
                                    Temporal.Now.instant().epochMilliseconds / 1000,
                                ),
                            },
                        },
                    };

                    userService.getUserByDisplayName.mockImplementation(() =>
                        Promise.resolve(user),
                    );

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
            it('should return 404 Not Found', () =>
                new Promise((done, reject) => {
                    const req = createRequest({
                        method: 'POST',
                        url: '/current/cryptarch',
                        headers: { 'x-csrf-token': csrfToken },
                        body: { channel: 'phone', code },
                        session: {
                            csrfToken,
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
                                timeStamp:
                                    Math.floor(Temporal.Now.instant().epochMilliseconds / 1000) -
                                    400, // Expired (older than 300 seconds TTL)
                            },
                        },
                    };

                    userService.getUserByDisplayName.mockImplementation(() =>
                        Promise.resolve(user),
                    );

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
            it('should return 404 Not Found', () =>
                new Promise((done, reject) => {
                    const req = createRequest({
                        method: 'POST',
                        url: '/current/cryptarch',
                        headers: { 'x-csrf-token': csrfToken },
                        body: { channel: 'phone', code },
                        session: {
                            csrfToken,
                            displayName,
                            membershipType,
                        },
                    });

                    userService.getUserByDisplayName.mockImplementation(() =>
                        Promise.resolve(null),
                    );

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
