// @ts-check
/**
 * Run a command, and if it has not finished within the limit, stop it and
 * everything it started (#783).
 *
 * A test run that never exits blocks a push indefinitely - one waited 34
 * minutes. Killing the command alone is not enough: `pnpm` exits, but the
 * `node` it started keeps running. So the command runs as the leader of its
 * own process group, and the whole group is killed.
 *
 * Exits with the command's own status, or 124 when it ran out of time (as
 * GNU `timeout` does, which macOS does not ship).
 *
 * Usage: node scripts/with-timeout.js <seconds> <command> [args...]
 */
import { spawn } from 'node:child_process';

const TIMED_OUT = 124;

const [seconds, command, ...args] = process.argv.slice(2);
const limit = Number(seconds);

if (!command || !(limit > 0)) {
    console.error('Usage: node scripts/with-timeout.js <seconds> <command> [args...]');
    process.exit(2);
}

const child = spawn(command, args, { stdio: 'inherit', detached: true });

/**
 * Signal the command's whole process group; it may already be gone.
 * @param {NodeJS.Signals} signal
 */
const signalGroup = signal => {
    try {
        process.kill(-(/** @type {number} */ (child.pid)), signal);
    } catch {
        // Nothing left to signal.
    }
};

const timer = setTimeout(() => {
    console.error(
        `\n${[command, ...args].join(' ')} did not finish within ${limit}s; stopping it (#783).`,
    );
    process.exitCode = TIMED_OUT;
    signalGroup('SIGKILL');
}, limit * 1000);

child.on('exit', code => {
    clearTimeout(timer);
    if (process.exitCode !== TIMED_OUT) process.exitCode = code ?? 1;
});

child.on('error', err => {
    clearTimeout(timer);
    console.error(err.message);
    process.exitCode = 127;
});

/**
 * The command has its own process group, so a Ctrl-C at the terminal no
 * longer reaches it on its own; pass it on.
 */
for (const signal of /** @type {const} */ (['SIGINT', 'SIGTERM'])) {
    process.on(signal, () => signalGroup(signal));
}
