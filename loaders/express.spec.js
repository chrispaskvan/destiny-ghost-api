import { EventEmitter } from 'node:events';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createRequest, createResponse } from 'node-mocks-http';
import { Router } from 'express';
import expressLoader from './express.js';

const { sessionMiddleware, preflight, jsonParser, formParser, contextMiddleware, httpLog } =
    vi.hoisted(() => ({
        sessionMiddleware: vi.fn(),
        preflight: vi.fn(),
        jsonParser: vi.fn(),
        formParser: vi.fn(),
        contextMiddleware: vi.fn(),
        httpLog: vi.fn(),
    }));

vi.mock('express', async importOriginal => {
    const actual = await importOriginal();
    return {
        ...actual,
        default: {
            json: options => (req, res, next) => jsonParser(options, req, res, next),
            urlencoded: options => (req, res, next) => formParser(options, req, res, next),
        },
    };
});
vi.mock('express-session', () => ({ default: () => sessionMiddleware }));
vi.mock('../helpers/store.js', () => ({ default: {} }));
vi.mock('../helpers/rate-limiter.middleware.js', () => ({ twilioPreflightMiddleware: preflight }));
vi.mock('../helpers/httpLog.js', () => ({ default: httpLog }));
vi.mock('../helpers/log.js', () => ({ contextMiddleware }));
vi.mock('compression', () => ({ default: () => (_req, _res, next) => next() }));
vi.mock('cors', () => ({ default: () => (_req, _res, next) => next() }));
vi.mock('helmet', () => ({
    default: { crossOriginResourcePolicy: () => (_req, _res, next) => next() },
}));

describe('Express session and webhook boundaries', () => {
    let app;

    beforeEach(() => {
        vi.resetAllMocks();
        contextMiddleware.mockImplementation((_req, res, next) => {
            res.locals.traceId = 'test-trace';
            next();
        });
        httpLog.mockImplementation((_req, res, next) => {
            res.setHeader('X-Trace-Id', res.locals.traceId);
            next();
        });
        sessionMiddleware.mockImplementation((_req, _res, next) => next());
        preflight.mockImplementation((_req, _res, next) => next());
        jsonParser.mockImplementation((_options, _req, _res, next) => next());
        formParser.mockImplementation((_options, _req, _res, next) => next());
        app = Router();
        app.disable = vi.fn().mockReturnThis();
        app.set = vi.fn();
        expressLoader(app);
        app.use((_req, res) => res.status(200).end());
        app.use((err, _req, res, _next) => res.status(err.statusCode ?? 500).end());
    });

    function request(url) {
        const req = createRequest({ method: 'POST', url, headers: { cookie: 'session=stale' } });
        const res = createResponse({ eventEmitter: EventEmitter });
        delete req.session;
        req.setTimeout = vi.fn();
        res.setTimeout = vi.fn();
        return new Promise((resolve, reject) => {
            res.on('end', () => resolve(res));
            app(req, res, reject);
        });
    }

    it.each(['/twilio/destiny/r', '/twilio/destiny/s', '/twilio/destiny/f', '/TWILIO/destiny/r'])(
        'allows %s without loading a session even when the store throws',
        async path => {
            sessionMiddleware.mockImplementation((_req, _res, next) =>
                next(new Error('Redis unavailable')),
            );

            const res = await request(path);

            expect(res.statusCode).toBe(200);
            expect(sessionMiddleware).not.toHaveBeenCalled();
            expect(preflight).toHaveBeenCalledTimes(1);
        },
    );

    it.each(['/users', '/director', '/twilio-other'])(
        'still requires a session for %s',
        async path => {
            const res = await request(path);

            expect(res.statusCode).toBe(503);
            expect(sessionMiddleware).toHaveBeenCalledTimes(1);
            expect(preflight).not.toHaveBeenCalled();
        },
    );

    it.each([403, 429])(
        'logs a preflight %s before either body parser or session loading',
        async status => {
            preflight.mockImplementation((_req, res) => res.status(status).end());

            const res = await request('/twilio/destiny/r');

            expect(res.statusCode).toBe(status);
            expect(res.getHeader('X-Trace-Id')).toBe('test-trace');
            expect(contextMiddleware).toHaveBeenCalledTimes(1);
            expect(httpLog).toHaveBeenCalledTimes(1);
            expect(contextMiddleware.mock.invocationCallOrder[0]).toBeLessThan(
                httpLog.mock.invocationCallOrder[0],
            );
            expect(httpLog.mock.invocationCallOrder[0]).toBeLessThan(
                preflight.mock.invocationCallOrder[0],
            );
            expect(jsonParser).not.toHaveBeenCalled();
            expect(formParser).not.toHaveBeenCalled();
            expect(sessionMiddleware).not.toHaveBeenCalled();
        },
    );

    it('applies smaller webhook parser limits before global parsers', async () => {
        await request('/twilio/destiny/r');

        expect(jsonParser.mock.calls[0][0].limit).toBe('32kb');
        expect(formParser.mock.calls[0][0]).toEqual({
            limit: '32kb',
            extended: true,
            parameterLimit: 51,
        });
        expect(jsonParser.mock.calls[1][0].limit).toBe('1mb');
        expect(formParser.mock.calls[1][0].limit).toBe('1mb');
    });
});
