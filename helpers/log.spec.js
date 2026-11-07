import { describe, expect, it } from 'vitest';
import context from './async-context.js';
import log, { contextMiddleware, getWorkerExecArgv, runWithBindings } from './log.js';

describe('getWorkerExecArgv', () => {
    it('should remove unsupported worker execArgv flags', () => {
        const execArgv = [
            '--disable-proto=delete',
            '--max-old-space-size=8192',
            '--trace-warnings',
        ];

        const result = getWorkerExecArgv(execArgv);

        expect(result).toEqual(['--trace-warnings']);
    });

    it('should keep supported worker execArgv flags unchanged', () => {
        const execArgv = ['--trace-warnings', '--dns-result-order=ipv4first'];

        const result = getWorkerExecArgv(execArgv);

        expect(result).toEqual(execArgv);
    });

    it('should return an empty array when no flags are provided', () => {
        const result = getWorkerExecArgv([]);

        expect(result).toEqual([]);
    });
});

describe('contextMiddleware', () => {
    it('should run the request with its own logger and empty timings and lookups', () => {
        /** @type {Map<string, unknown> | undefined} */
        let store;

        // @ts-expect-error - only next is called
        contextMiddleware({}, {}, () => {
            store = context.getStore();
        });

        expect(store?.get('logger')).toBeDefined();
        expect(store?.get('timings')).toEqual([]);
        expect(store?.get('lookups')).toEqual([]);
    });
});

describe('runWithBindings', () => {
    it('should log through the real logger with the given bindings', () => {
        /**
         * Through the exported proxy, not a stand-in: a child made from the
         * proxy looked its methods up through the proxy into itself, and the
         * first line a job logged overflowed the stack.
         */
        const bindings = runWithBindings({ traceId: 'trace-1', jobId: 'job-7' }, () => {
            log.debug('a line from a job');

            return log.bindings();
        });

        expect(bindings).toMatchObject({ traceId: 'trace-1', jobId: 'job-7' });
    });

    it("should return what the function returns, and leave the caller's context alone", async () => {
        await expect(runWithBindings({ jobId: 'job-7' }, async () => 'done')).resolves.toBe('done');
        expect(context.getStore()).toBeUndefined();
    });
});
