import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createResponse, createRequest } from 'node-mocks-http';
import configuration from '../helpers/config.js';
import authorizeUser, { assertCredentials, callerOf } from './authorization.middleware.js';
import { StatusCodes } from 'http-status-codes';

describe('authorizeUser', () => {
    const next = vi.fn().mockImplementation(() => {});
    let res;

    beforeEach(() => {
        vi.resetAllMocks();
        res = createResponse();
    });

    describe('when the notification header is missing', () => {
        it('should return 401', () => {
            const req = createRequest({
                headers: {},
            });

            authorizeUser(req, res, next);

            expect(res.statusCode).toEqual(StatusCodes.UNAUTHORIZED);
            expect(next).not.toBeCalled();
            expect(res.locals.caller).toBeUndefined();
        });
    });

    describe('when the notification header is incorrect', () => {
        it('should return 401', () => {
            const req = createRequest({
                headers: {
                    'x-destiny-': 'thorn',
                },
            });

            authorizeUser(req, res, next);

            expect(res.statusCode).toEqual(StatusCodes.UNAUTHORIZED);
            expect(next).not.toBeCalled();
            expect(res.locals.caller).toBeUndefined();
        });
    });

    describe('when the notification header is correct', () => {
        it('should call next', () => {
            const req = createRequest({
                headers: configuration.notificationHeaders,
            });

            authorizeUser(req, res, next);

            expect(next).toBeCalled();
            expect(res.locals.caller).toBe('notification-headers');
        });
    });

    describe('when the API key is valid', () => {
        it('should call next', () => {
            const apiKey = configuration.apiKeys[0];
            const req = createRequest({
                headers: {
                    [apiKey.header]: apiKey.key,
                },
            });

            authorizeUser(req, res, next);

            expect(next).toBeCalled();
            expect(res.locals.caller).toBe(apiKey.header);
        });
    });
});

describe('callerOf', () => {
    const credentials = {
        apiKeys: [{ header: 'x-api-key', key: 'k-1' }],
        notificationHeaders: { 'x-destiny-ghost': 'thorn', 'x-destiny-vendor': 'xur' },
    };

    it('matches an API key, answering with its header', () => {
        expect(callerOf({ 'x-api-key': 'k-1' }, credentials)).toBe('x-api-key');
    });

    it('rejects a wrong key, including one that only shares a prefix', () => {
        for (const given of ['k-2', 'k-', 'k-11', '']) {
            expect(callerOf({ 'x-api-key': given }, credentials)).toBeUndefined();
        }
    });

    /** Node lowercases incoming header names. */
    it('matches a key whose header is configured in mixed case', () => {
        const mixed = { ...credentials, apiKeys: [{ header: 'X-Api-Key', key: 'k-1' }] };

        expect(callerOf({ 'x-api-key': 'k-1' }, mixed)).toBe('X-Api-Key');
    });

    it('needs every notification header, with its value', () => {
        expect(
            callerOf({ 'x-destiny-ghost': 'thorn', 'x-destiny-vendor': 'xur' }, credentials),
        ).toBe('notification-headers');
        expect(callerOf({ 'x-destiny-ghost': 'thorn' }, credentials)).toBeUndefined();
        expect(
            callerOf({ 'x-destiny-ghost': 'thorn', 'x-destiny-vendor': 'ada' }, credentials),
        ).toBeUndefined();
    });

    it('rejects a header sent twice', () => {
        expect(callerOf({ 'x-api-key': ['k-1', 'k-1'] }, credentials)).toBeUndefined();
    });

    /**
     * The two latent holes: before, `{}` matched every request, and a key
     * entry with no `key` matched any request that left its header out.
     */
    it.each([
        ['empty notification headers', { apiKeys: [], notificationHeaders: {} }],
        ['an API key with no key', { apiKeys: [{ header: 'x-api-key' }], notificationHeaders: {} }],
        [
            'an API key with an empty key',
            { apiKeys: [{ header: 'x-api-key', key: '' }], notificationHeaders: {} },
        ],
        ['an API key with no header', { apiKeys: [{ key: 'k-1' }], notificationHeaders: {} }],
    ])('lets nothing through with %s', (_, broken) => {
        expect(callerOf({}, broken)).toBeUndefined();
        expect(callerOf({ 'x-api-key': '' }, broken)).toBeUndefined();
    });
});

describe('assertCredentials', () => {
    const valid = {
        apiKeys: [{ header: 'x-api-key', key: 'k-1' }],
        notificationHeaders: { 'x-destiny-ghost': 'thorn' },
    };

    it('accepts complete credentials', () => {
        expect(() => assertCredentials(valid)).not.toThrow();
    });

    it('accepts the settings this suite runs with', () => {
        expect(() => assertCredentials()).not.toThrow();
    });

    it('accepts no API keys, so long as notification headers are set', () => {
        expect(() => assertCredentials({ ...valid, apiKeys: [] })).not.toThrow();
    });

    it.each([
        ['missing notification headers', { apiKeys: valid.apiKeys }, 'notificationHeaders'],
        [
            'empty notification headers',
            { ...valid, notificationHeaders: {} },
            'notificationHeaders',
        ],
        [
            'a notification header with no value',
            { ...valid, notificationHeaders: { 'x-destiny-ghost': '' } },
            'notificationHeaders',
        ],
        ['missing API keys', { notificationHeaders: valid.notificationHeaders }, 'apiKeys'],
        [
            'an API key with no key',
            { ...valid, apiKeys: [{ header: 'x-api-key' }] },
            'apiKeys.0.key',
        ],
        ['an API key with no header', { ...valid, apiKeys: [{ key: 'k-1' }] }, 'apiKeys.0.header'],
    ])('refuses to start with %s, naming the setting', (_, broken, setting) => {
        expect(() => assertCredentials(broken)).toThrow(setting);
    });

    it('never puts a credential in its message', () => {
        const leaky = {
            apiKeys: [{ header: 'x-api-key', key: '' }],
            notificationHeaders: { 'x-secret': 'hunter2' },
        };

        expect(() => assertCredentials(leaky)).toThrow(
            expect.objectContaining({
                message: expect.not.stringContaining('hunter2'),
            }),
        );
    });
});
