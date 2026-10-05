// @ts-check
/**
 * How long the event loop was late to run a timer. Synchronous work - JSON
 * parsing, a CPU-bound loop, garbage collection reading pages back from swap -
 * delays every other request without moving CPU percentage much, so this
 * shows it where CPU does not.
 *
 * Measuring starts when this module is evaluated, which start.js does before
 * anything else, so the first read covers startup. server.js reads it once
 * the server is listening, which leaves /health/metrics reporting only time
 * the server could have been answering requests.
 *
 * @module event-loop-delay
 */
import { monitorEventLoopDelay } from 'node:perf_hooks';

const resolution = 10;
// Its timer is unref'd, so it never holds the process open
const histogram = monitorEventLoopDelay({ resolution });

histogram.enable();

/**
 * Percentiles since the last read, in milliseconds, then starts over.
 *
 * The histogram records the whole interval between its timer's runs, so an
 * idle loop reads as the resolution; that is subtracted to leave the delay.
 * The first interval after a reset is discarded by the histogram itself.
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

export default readEventLoopDelay;
