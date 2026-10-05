// @ts-check
/**
 * How long the event loop was late to run a timer. Synchronous work - JSON
 * parsing, a CPU-bound loop, garbage collection reading pages back from swap -
 * delays every other request without moving CPU percentage much, so this
 * shows it where CPU does not.
 *
 * Measuring starts when this module is evaluated, which start.js does before
 * anything else. server.js reads startup's delay once the server is
 * listening, which leaves /health/metrics reporting only time the server
 * could have been answering requests.
 *
 * @module event-loop-delay
 */
import { monitorEventLoopDelay } from 'node:perf_hooks';

const resolution = 10;
// Its timer is unref'd, so it never holds the process open
const histogram = monitorEventLoopDelay({ resolution });

histogram.enable();

const evaluatedAt = performance.now();

/**
 * The histogram discards its first interval, and at startup that interval is
 * the synchronous evaluation of every module imported after this one - the
 * stall startup is read for. A timer set now runs only once the loop first
 * gets to its timers, after all of startup's synchronous work, so how late it
 * ran is that stall. Its timer is unref'd too.
 *
 * @type {Promise<number>}
 */
const firstTurn = new Promise(resolve => {
    setTimeout(() => resolve(performance.now() - evaluatedAt), 0).unref();
});

/**
 * Percentiles since the last read, in milliseconds, then starts over.
 *
 * The histogram records the whole interval between its timer's runs, so an
 * idle loop reads as the resolution; that is subtracted to leave the delay.
 * It also discards the first interval after a reset, so a stall that begins
 * within one resolution of a read goes uncounted, however long it lasts.
 *
 * @returns {{ p50: number, p95: number, p99: number, max: number }}
 */
const readEventLoopDelay = () => {
    /** @param {number} nanoseconds */
    const toMilliseconds = nanoseconds =>
        Math.max(0, Math.round(nanoseconds / 1e4 - resolution * 100) / 100);
    const delay = {
        p50: toMilliseconds(histogram.percentile(50)),
        p95: toMilliseconds(histogram.percentile(95)),
        p99: toMilliseconds(histogram.percentile(99)),
        max: toMilliseconds(histogram.max),
    };

    histogram.reset();

    return delay;
};

/**
 * Startup's delay, read once the loop has first reached its timers - not
 * when called. server.js calls it when the server starts listening, which
 * can be in the same turn as the modules evaluating: read then, the
 * histogram had sampled none of it, and the reset left it to land in the
 * first /health/metrics read instead.
 *
 * @returns {Promise<{ p50: number, p95: number, p99: number, max: number }>}
 */
const readStartupEventLoopDelay = async () => {
    const evaluationDelay = await firstTurn;
    const delay = readEventLoopDelay();

    return { ...delay, max: Math.max(delay.max, Math.round(evaluationDelay * 100) / 100) };
};

export default readEventLoopDelay;
export { readStartupEventLoopDelay };
