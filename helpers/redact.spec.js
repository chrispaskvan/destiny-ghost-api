import Chance from 'chance';
import pino, { stdSerializers } from 'pino';
import { beforeEach, describe, expect, it } from 'vitest';
import redact, { censor, redactQuery, redactUrl } from './redact.js';

const chance = new Chance();

/**
 * The assertions here are on what Pino actually wrote, not on a helper's
 * return value. Redaction is a property of the serialized line - a sentinel
 * that survives into the log file has defeated it however tidy the object
 * looked on the way in.
 */
describe('redact', () => {
    let lines;
    let logger;

    beforeEach(() => {
        lines = [];
        logger = pino(
            {
                redact,
                serializers: {
                    err: stdSerializers.err,
                    req: stdSerializers.req,
                    res: stdSerializers.res,
                },
            },
            { write: line => lines.push(line) },
        );
    });

    const lastEvent = () => JSON.parse(lines.at(-1));

    describe('when a credential is at the root of an event', () => {
        it('should censor it', () => {
            const accessToken = chance.hash({ length: 40 });

            logger.info({ access_token: accessToken }, 'Signed in');

            expect(lastEvent().access_token).toEqual(censor);
            expect(lines.at(-1)).not.toContain(accessToken);
        });
    });

    describe('when a credential is nested inside a user document', () => {
        it('should censor the grant one level down', () => {
            const refreshToken = chance.hash({ length: 40 });

            logger.info({ bungie: { refresh_token: refreshToken } }, 'Refreshed');

            expect(lastEvent().bungie).toEqual(censor);
            expect(lines.at(-1)).not.toContain(refreshToken);
        });

        it('should censor the grant two levels down', () => {
            const accessToken = chance.hash({ length: 40 });

            logger.info({ user: { bungie: { access_token: accessToken } } }, 'Authenticated');

            expect(lastEvent().user.bungie).toEqual(censor);
            expect(lines.at(-1)).not.toContain(accessToken);
        });

        /**
         * The document has to be caught under whatever name the call site gave
         * it, not only under `user`. Naming the containers - `bungie`,
         * `tokens` - is what makes that hold without a wildcard per level.
         */
        it.each(['user', 'bungieUser', 'registeredUser'])(
            'should censor a whole user document logged as %s',
            key => {
                const accessToken = chance.hash({ length: 40 });
                const blob = chance.hash({ length: 32 });
                const code = chance.string({ length: 6, pool: '0123456789' });
                const document = {
                    displayName: chance.name(),
                    bungie: { access_token: accessToken, refresh_token: chance.hash() },
                    membership: { tokens: { blob, code } },
                };

                logger.info({ [key]: document }, 'Processing');

                const logged = lastEvent()[key];

                expect(logged.bungie).toEqual(censor);
                expect(logged.membership.tokens).toEqual(censor);
                expect(lines.at(-1)).not.toContain(accessToken);
                expect(lines.at(-1)).not.toContain(blob);
                expect(lines.at(-1)).not.toContain(code);
                // The fields that make the line useful are untouched.
                expect(logged.displayName).toEqual(document.displayName);
            },
        );
    });

    /**
     * Censored as an object rather than field by field, so a member added to
     * it later is covered without this list being revisited.
     */
    describe('when a verification token is nested inside a membership', () => {
        it('should censor the whole token', () => {
            const blob = chance.hash({ length: 32 });
            const code = chance.string({ length: 6, pool: '0123456789' });

            logger.info({ membership: { tokens: { blob, code } } }, 'Signed up');

            expect(lastEvent().membership.tokens).toEqual(censor);
            expect(lines.at(-1)).not.toContain(blob);
            expect(lines.at(-1)).not.toContain(code);
        });

        it('should censor a join request token, whose members are named differently', () => {
            const emailAddress = chance.hash({ length: 32 });

            logger.info({ tokens: { emailAddress, phoneNumber: '123456' } }, 'Joined');

            expect(lastEvent().tokens).toEqual(censor);
            expect(lines.at(-1)).not.toContain(emailAddress);
        });
    });

    /**
     * Pino matches these paths case-sensitively. Node lower-cases what it
     * parses off the wire, but `helpers/bitly.js` and `twilio/mms.service.js`
     * build an `Authorization` header by hand.
     */
    describe('when a header is spelled with its conventional capital', () => {
        it('should censor it too', () => {
            const authorization = `Bearer ${chance.hash({ length: 40 })}`;

            logger.info({ Authorization: authorization }, 'Calling out');

            expect(lastEvent().Authorization).toEqual(censor);
            expect(lines.at(-1)).not.toContain(authorization);
        });
    });

    describe('when the standard serializers produce request and response headers', () => {
        it('should censor the credentials among them', () => {
            const apiKey = chance.guid();
            const authorization = `Bearer ${chance.hash({ length: 40 })}`;
            const sessionCookie = `destiny-ghost=${chance.hash({ length: 32 })}`;
            const req = {
                method: 'GET',
                url: '/users/current',
                headers: {
                    authorization,
                    cookie: sessionCookie,
                    'x-api-key': apiKey,
                    'user-agent': 'vitest',
                },
                socket: {},
            };
            const res = {
                statusCode: 200,
                getHeaders: () => ({ 'set-cookie': [sessionCookie], 'content-type': 'text/html' }),
            };

            req.raw = req;
            res.raw = res;

            logger.info({ req, res }, 'request completed');

            const event = lastEvent();

            expect(event.req.headers).toEqual({
                authorization: censor,
                cookie: censor,
                'x-api-key': censor,
                'user-agent': 'vitest',
            });
            expect(event.res.headers['set-cookie']).toEqual(censor);
            expect(event.res.headers['content-type']).toEqual('text/html');
            expect(lines.at(-1)).not.toContain(apiKey);
            expect(lines.at(-1)).not.toContain(authorization);
            expect(lines.at(-1)).not.toContain(sessionCookie);
        });
    });

    /**
     * The reason redaction lives on the logger rather than in a
     * `formatters.log` hook. A child's bindings are serialized when the child
     * is created and never pass through that hook, so `contextMiddleware`'s
     * per-request child - and anything bound onto one - would escape it.
     */
    describe('when a credential is bound onto a child logger', () => {
        it('should censor it', () => {
            const accessToken = chance.hash({ length: 40 });

            logger.child({ user: { bungie: { access_token: accessToken } } }).info('Processing');

            expect(lastEvent().user.bungie).toEqual(censor);
            expect(lines.at(-1)).not.toContain(accessToken);
        });
    });

    /**
     * `code` is a credential only under `tokens`. Censoring it outright would
     * take `err.code` with it, which is the field that says what went wrong.
     */
    describe('when an event carries diagnostics that resemble credentials', () => {
        it('should leave them legible', () => {
            const err = new Error('Bungie is down');

            err.code = 'ECONNREFUSED';

            logger.error({ err, statusCode: 503 }, 'Request failed');

            const event = lastEvent();

            expect(event.err.code).toEqual('ECONNREFUSED');
            expect(event.err.message).toEqual('Bungie is down');
            expect(event.statusCode).toEqual(503);
        });
    });
});

describe('redactUrl', () => {
    describe('when the url is the Bungie OAuth callback', () => {
        it('should censor the authorization code and the state', () => {
            const code = chance.hash({ length: 32 });
            const state = chance.guid();

            const result = redactUrl(`/users/signIn/Bungie?code=${code}&state=${state}`);

            expect(result).toEqual(`/users/signIn/Bungie?code=${censor}&state=${censor}`);
            expect(result).not.toContain(code);
            expect(result).not.toContain(state);
        });
    });

    describe('when a sensitive parameter repeats', () => {
        it('should leave no occurrence behind', () => {
            const code = chance.hash({ length: 32 });

            const result = redactUrl(`/callback?code=${code}&code=${code}`);

            expect(result).not.toContain(code);
        });
    });

    describe('when the parameters are not credentials', () => {
        it('should return the url unchanged', () => {
            const url = '/destiny2/inventory?page=2&size=50';

            expect(redactUrl(url)).toEqual(url);
        });
    });

    describe('when the url has no query string', () => {
        it('should return it unchanged', () => {
            expect(redactUrl('/users/current')).toEqual('/users/current');
        });
    });
});

/**
 * Express parses the query into an object that Pino's request serializer
 * copies out whole, so the OAuth code appears twice in a serialized request -
 * once in the URL, once here.
 */
describe('redactQuery', () => {
    describe('when the query is the Bungie OAuth callback', () => {
        it('should censor the authorization code and the state', () => {
            const code = chance.hash({ length: 32 });
            const state = chance.guid();

            expect(redactQuery({ code, state })).toEqual({ code: censor, state: censor });
        });
    });

    describe('when the parameters are not credentials', () => {
        it('should leave them legible', () => {
            expect(redactQuery({ page: '2', size: '50' })).toEqual({ page: '2', size: '50' });
        });
    });

    describe('when the query is empty', () => {
        it('should return an empty object', () => {
            expect(redactQuery({})).toEqual({});
        });
    });
});
