import { describe, expect, it } from 'vitest';
import { getWorkerExecArgv } from './log.js';

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
