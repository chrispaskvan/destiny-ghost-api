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
});
