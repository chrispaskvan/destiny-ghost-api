// @ts-check
import cache from './cache.js';
import processExternalPromisesWithTimeout from './process-external-promises-with-timeout.js';

/**
 * Run a command against the cache, waiting no longer than the timeout.
 *
 * node-redis queues commands while it reconnects rather than failing them, so
 * an unbounded command does not fail on a dropped connection - it waits for one
 * that may not come back, holding up whatever awaits it.
 *
 * Stopping waiting is not enough either. The command is sent with the same
 * timeout as node-redis's own, so one still waiting to be written when it
 * passes is dropped rather than sent once the client reconnects - a write the
 * caller has given up on landing later, after whatever it was meant to
 * precede. node-redis's timeout covers a command only until it is written, so
 * the race here still bounds the wait for the reply; a command written to a
 * Redis that is slow but connected runs when it gets there, as any would.
 * MULTI ignores command options, so a transaction is not dropped: use a script.
 *
 * A write that is better late than never - one whose script compares before
 * it writes, so landing after newer state does no harm - can keep its
 * command instead (`keepUnsent`): the caller still stops waiting, and the
 * command goes out when the client reconnects, ahead of any sent after it.
 *
 * Takes the command unbuilt, so a client that throws while building it
 * rejects like any other failure.
 * @template T
 * @param {(client: typeof cache) => Promise<T>} command
 * @param {number} timeout - milliseconds
 * @param {string} name - what is being asked, for the timeout's message
 * @param {{ keepUnsent?: boolean }} [options]
 * @returns {Promise<T>} what the command resolved with; rejects with its
 * error, or with one of its own when it timed out
 */
const boundedCommand = async (command, timeout, name, { keepUnsent = false } = {}) => {
    const [result] = await processExternalPromisesWithTimeout(
        [command(keepUnsent ? cache : cache.withCommandOptions({ timeout }))],
        timeout,
    );

    if (result.status === 'fulfilled') return result.value;
    if (result.status === 'rejected') throw result.reason;

    throw new Error(`The ${name} did not answer within ${timeout}ms.`);
};

export default boundedCommand;
