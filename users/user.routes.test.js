import nock from 'nock';
import { StatusCodes } from 'http-status-codes';
import { afterAll, afterEach, beforeAll, describe, expect, test, vi } from 'vitest';
import AuthenticationService from '../authentication/authentication.service.js';
import { startServer, stopServer } from '../server.js';

vi.mock('../helpers/subscriber.js');

let baseUrl;
const ipAddress = '127.0.0.1';
const origin = 'https://app.destiny-ghost.com';

beforeAll(async () => {
    process.env.PORT = 65533;

    const apiConnection = await startServer();

    baseUrl = `http://${ipAddress}:${apiConnection.port}`;

    // Ensure that this component is isolated by preventing unknown calls.
    nock.disableNetConnect();
    nock.enableNetConnect(ipAddress);
});

/**
 * The If-Match flow on PATCH /users only works cross-origin when the browser
 * is allowed to read the ETag response header, so every response must carry
 * Access-Control-Expose-Headers: ETag regardless of deployment configuration
 * (none is loaded in the test environment). CORS headers are set before
 * authentication, so anonymous requests exercise the contract end to end.
 */
describe('/users', () => {
    test.each(['/users/signUp', '/director'])(
        'POST %s rejects an anonymous From field before authentication or downstream handling',
        async path => {
            const authenticate = vi
                .spyOn(AuthenticationService.prototype, 'authenticate')
                .mockResolvedValue({ displayName: 'other-user', membershipType: 2 });

            try {
                const response = await fetch(`${baseUrl}${path}`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        From: '+15005550006',
                        query: '{ __typename }',
                    }),
                });

                expect(response.status).toBe(StatusCodes.UNAUTHORIZED);
                expect(authenticate).not.toHaveBeenCalled();
            } finally {
                authenticate.mockRestore();
            }
        },
    );

    describe('GET /users/current', () => {
        describe('when an anonymous cross-origin client requests the current user', () => {
            test('should expose the ETag header required for If-Match updates', async () => {
                const response = await fetch(`${baseUrl}/users/current`, {
                    method: 'GET',
                    headers: {
                        Origin: origin,
                    },
                });

                expect(response.status).toEqual(StatusCodes.UNAUTHORIZED);
                expect(response.headers.get('Access-Control-Expose-Headers')).toContain('ETag');
            });
        });
    });

    describe('GET /users/current/csrfToken', () => {
        describe('when an anonymous client requests a CSRF token', () => {
            test('should require authentication', async () => {
                const response = await fetch(`${baseUrl}/users/current/csrfToken`, {
                    method: 'GET',
                    headers: {
                        Origin: origin,
                    },
                });

                expect(response.status).toEqual(StatusCodes.UNAUTHORIZED);
            });
        });
    });

    describe('PATCH /users', () => {
        describe('when an anonymous cross-origin client updates the current user', () => {
            test('should expose the ETag header required for If-Match updates', async () => {
                const response = await fetch(`${baseUrl}/users`, {
                    method: 'PATCH',
                    headers: {
                        'Content-Type': 'application/json',
                        'If-Match': '"0"',
                        Origin: origin,
                    },
                    body: JSON.stringify([
                        { op: 'replace', path: '/notifications/0/enabled', value: true },
                    ]),
                });

                expect(response.status).toEqual(StatusCodes.UNAUTHORIZED);
                expect(response.headers.get('Access-Control-Expose-Headers')).toContain('ETag');
            });
        });

        describe('when a client sends a prototype-poisoning JSON body', () => {
            test('should reject the request as a bad request', async () => {
                const response = await fetch(`${baseUrl}/users`, {
                    method: 'PATCH',
                    headers: {
                        'Content-Type': 'application/json',
                        Origin: origin,
                    },
                    body: '{"__proto__":{"polluted":true}}',
                });

                expect(response.status).toEqual(StatusCodes.BAD_REQUEST);
            });
        });
    });
});

afterEach(() => {
    nock.cleanAll();
});

/**
 * Clean up resources after each run.
 */
afterAll(async () => {
    await stopServer();
    nock.enableNetConnect();
});
