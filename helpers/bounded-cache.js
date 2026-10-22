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
 * command goes out when the client reconnects, ahead of any sent after it on
 * this client. Its timeout is then not a failure, and says so
 * (`stillPending`); if the kept command does fail afterwards, nobody is
 * awaiting it any more, so `onLateFailure` is how the caller hears.
 *
 * Takes the command unbuilt, so a client that throws while building it
 * rejects like any other failure.
 * @template T
 * @param {(client: typeof cache) => Promise<T>} command
 * @param {number} timeout - milliseconds
 * @param {string} name - what is being asked, for the timeout's message
 * @param {{ keepUnsent?: boolean, onLateFailure?: (err: unknown) => void }} [options]
 * @returns {Promise<T>} what the command resolved with; rejects with its
 * error, or with one of its own when it timed out - marked `stillPending`
 * when the command was kept
 */
const boundedCommand = async (
    command,
    timeout,
    name,
    { keepUnsent = false, onLateFailure } = {},
) => {
    const pending = command(keepUnsent ? cache : cache.withCommandOptions({ timeout }));
    const [result] = await processExternalPromisesWithTimeout([pending], timeout);

    if (result.status === 'fulfilled') return result.value;
    if (result.status === 'rejected') throw result.reason;

    if (keepUnsent) {
        pending.catch(err => onLateFailure?.(err));

        throw Object.assign(
            new Error(
                `The ${name} did not answer within ${timeout}ms; the command was kept and may yet land.`,
            ),
            { stillPending: true },
        );
    }

    throw new Error(`The ${name} did not answer within ${timeout}ms.`);
};

export default boundedCommand;
