import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const script = fileURLToPath(new URL('./with-timeout.js', import.meta.url));

/**
 * Run the script to completion.
 * @param {string[]} args
 */
const run = args =>
    new Promise(resolve => {
        const started = Date.now();
        const child = spawn(process.execPath, [script, ...args], {
            stdio: ['ignore', 'pipe', 'pipe'],
        });
        let stderr = '';

        child.stderr.on('data', chunk => {
            stderr += chunk;
        });
        child.on('exit', code => resolve({ code, stderr, elapsed: Date.now() - started }));
    });

/** @param {number} pid */
const isRunning = pid => {
    try {
        process.kill(pid, 0);

        return true;
    } catch {
        return false;
    }
};

describe('with-timeout', () => {
    it("should exit with the command's own status when it finishes in time", async () => {
        await expect(run(['5', process.execPath, '-e', 'process.exit(3)'])).resolves.toMatchObject({
            code: 3,
        });
    });

    it('should stop a command that runs too long, exiting 124', async () => {
        const { code, stderr, elapsed } = await run([
            '1',
            process.execPath,
            '-e',
            'setTimeout(() => {}, 60_000)',
        ]);

        expect(code).toBe(124);
        expect(stderr).toContain('did not finish within 1s');
        expect(elapsed).toBeLessThan(10_000);
    });

    /**
     * The point of it: `pnpm` exits on a kill, but the `node` it started
     * keeps running unless the whole process group goes.
     */
    it('should stop what the command started, not only the command', async () => {
        const grandchild = `
            const { spawn } = require('node:child_process');
            const sleeper = spawn(process.execPath, ['-e', 'setTimeout(() => {}, 60_000)'], { stdio: 'ignore' });
            console.error('PID ' + sleeper.pid);
            setTimeout(() => {}, 60_000);
        `;
        const { code, stderr } = await run(['1', process.execPath, '-e', grandchild]);
        const pid = Number(/PID (\d+)/.exec(stderr)?.[1]);

        expect(code).toBe(124);
        expect(pid).toBeGreaterThan(0);
        await new Promise(resolve => setTimeout(resolve, 200));
        expect(isRunning(pid)).toBe(false);
    });

    it('should refuse to run without a limit and a command', () => {
        expect(spawnSync(process.execPath, [script, 'soon']).status).toBe(2);
    });
});
