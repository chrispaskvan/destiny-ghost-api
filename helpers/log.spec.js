import { describe, expect, it } from 'vitest';
import context from './async-context.js';
import { contextMiddleware, getWorkerExecArgv } from './log.js';

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
