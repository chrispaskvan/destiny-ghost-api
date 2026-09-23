import Chance from 'chance';
import { createRequest } from 'node-mocks-http';
import pino from 'pino';
import { describe, expect, it, vi } from 'vitest';

/**
 * A real logger, because `pino-http` reads `levels` off it at construction -
 * but one writing nowhere, so importing the module under test does not start
 * the pretty-printing transport worker.
 */
vi.mock('./log.js', () => ({
    default: pino({}, { write: () => {} }),
}));

import { requestSerializer } from './httpLog.js';
import { censor } from './redact.js';

const chance = new Chance();

describe('requestSerializer', () => {
    describe('when the request is the Bungie OAuth callback', () => {
        it('should censor the authorization code and the state on the request line', () => {
            const code = chance.hash({ length: 32 });
            const state = chance.guid();
            const req = createRequest({
                method: 'GET',
                url: `/users/signIn/Bungie?code=${code}&state=${state}`,
            });

            const { url } = requestSerializer(req);

            expect(url).toContain('/users/signIn/Bungie');
            expect(url).not.toContain(code);
            expect(url).not.toContain(state);
            expect(url).toContain(encodeURIComponent(censor));
        });
    });

    /**
     * The serializer copies Express's parsed query out alongside the URL, so
     * the code is in the event twice and both have to go.
     */
    describe('when the request has a parsed query', () => {
        it('should censor the credentials in it too', () => {
            const code = chance.hash({ length: 32 });
            const req = createRequest({
                method: 'GET',
                url: `/users/signIn/Bungie?code=${code}`,
                query: { code, redirect: '/home' },
            });

            const serialized = requestSerializer(req);

            expect(serialized.query).toEqual({ code: censor, redirect: '/home' });
            expect(JSON.stringify(serialized)).not.toContain(code);
        });
    });

    describe('when the request carries ordinary query parameters', () => {
        it('should leave the request line legible', () => {
            const req = createRequest({
                method: 'GET',
                url: '/destiny2/inventory?page=2&size=50',
            });

            expect(requestSerializer(req).url).toEqual('/destiny2/inventory?page=2&size=50');
        });
    });

    /**
     * The serializer is a wrapper, so the fields correlation depends on have
     * to survive it.
     */
    describe('when the request is serialized', () => {
        it('should keep the standard diagnostic fields', () => {
            const req = createRequest({
                method: 'POST',
                url: '/users/signUp',
                headers: { 'user-agent': 'vitest' },
            });

            const serialized = requestSerializer(req);

            expect(serialized.method).toEqual('POST');
            expect(serialized.headers['user-agent']).toEqual('vitest');
        });
    });
});
