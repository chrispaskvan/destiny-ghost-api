import Chance from 'chance';
import { createRequest } from 'node-mocks-http';
import pino, { stdSerializers } from 'pino';
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

/**
 * Exercised through `wrapRequestSerializer`, which is how `pino-http` installs
 * it: the wrapper runs `stdSerializers.req` first and passes its output on. A
 * test that called `requestSerializer` with a raw request instead would be
 * testing a shape that never reaches it in production - and did, in an earlier
 * revision, hide the serializer dropping `remoteAddress` and `remotePort`.
 */
const serialize = stdSerializers.wrapRequestSerializer(requestSerializer);

/**
 * @param {object} overrides
 */
const requestOf = ({ url, query }) => {
    const req = createRequest({ method: 'GET', url, query });

    req.socket = { remoteAddress: '203.0.113.7', remotePort: 51_234 };

    return req;
};

describe('requestSerializer', () => {
    describe('when the request is the Bungie OAuth callback', () => {
        it('should censor the authorization code and the state in the url', () => {
            const code = chance.hash({ length: 32 });
            const state = chance.guid();
            const serialized = serialize(
                requestOf({ url: `/users/signIn/Bungie?code=${code}&state=${state}` }),
            );

            expect(serialized.url).toContain('/users/signIn/Bungie');
            expect(serialized.url).not.toContain(code);
            expect(serialized.url).not.toContain(state);
            expect(serialized.url).toContain(censor);
        });

        /**
         * Express parses the query into an object the serializer copies out
         * beside the URL, so the code is in the event twice.
         */
        it('should censor them in the parsed query as well', () => {
            const code = chance.hash({ length: 32 });
            const serialized = serialize(
                requestOf({
                    url: `/users/signIn/Bungie?code=${code}`,
                    query: { code, redirect: '/home' },
                }),
            );

            expect(serialized.query).toEqual({ code: censor, redirect: '/home' });
            expect(JSON.stringify(serialized)).not.toContain(code);
        });

        /**
         * The serializer takes Express's own query object by reference. A
         * censor written in place would reach the route handler.
         */
        it('should not censor the query the route is about to read', () => {
            const code = chance.hash({ length: 32 });
            const req = requestOf({
                url: `/users/signIn/Bungie?code=${code}`,
                query: { code },
            });

            serialize(req);

            expect(req.query.code).toEqual(code);
        });
    });

    /**
     * `pino-http` hands a custom serializer the output of `stdSerializers.req`,
     * so anything this function rebuilds instead of edits is silently lost.
     * These are the fields that answer "who made this request".
     */
    describe('when the request is serialized', () => {
        it('should keep every field the standard serializer produced', () => {
            const req = requestOf({ url: '/destiny2/inventory?page=2&size=50' });

            req.headers['user-agent'] = 'vitest';

            const serialized = serialize(req);

            expect(serialized.remoteAddress).toEqual('203.0.113.7');
            expect(serialized.remotePort).toEqual(51_234);
            expect(serialized.method).toEqual('GET');
            expect(serialized.headers['user-agent']).toEqual('vitest');
            expect(serialized.url).toEqual('/destiny2/inventory?page=2&size=50');
            expect(Object.keys(serialized).sort()).toEqual(
                Object.keys(stdSerializers.req(requestOf({ url: '/destiny2/inventory' }))).sort(),
            );
        });

        /**
         * `pino-http` reads the original request back off the serialized one
         * through a non-enumerable getter on its prototype.
         */
        it('should keep the raw request reachable', () => {
            const req = requestOf({ url: '/users/current' });

            expect(serialize(req).raw).toBe(req);
        });
    });
});
