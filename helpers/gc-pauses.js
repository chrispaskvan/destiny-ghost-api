// @ts-check
/**
 * Logs garbage collection pauses long enough to stall requests.
 *
 * A collection stops JavaScript while it runs, and a major one visits every
 * live object: when part of the heap has been swapped to disk, as on the
 * production App Service plan, it reads those pages back first. Logging the
 * long ones, with the kind of collection and the heap at the time, shows
 * whether event-loop stalls in /health/metrics line up with collections.
 *
 * @module gc-pauses
 */
import { PerformanceObserver, constants } from 'node:perf_hooks';
import applicationInsights from './application-insights.js';
import log from './log.js';

/** Pauses shorter than this go unlogged; a forced full collection of a small heap takes ~40 ms. */
const threshold = 100;

/** @type {Record<number, string>} */
const kinds = {
    [constants.NODE_PERFORMANCE_GC_MINOR]: 'minor',
    // Node has it; @types/node does not declare it yet
    [/** @type {Record<string, number>} */ (constants).NODE_PERFORMANCE_GC_MINOR_MARK_SWEEP]:
        'minor mark-sweep',
    [constants.NODE_PERFORMANCE_GC_MAJOR]: 'major',
    [constants.NODE_PERFORMANCE_GC_INCREMENTAL]: 'incremental',
    [constants.NODE_PERFORMANCE_GC_WEAKCB]: 'weak callbacks',
};

/** @param {number} bytes */
const toMegabytes = bytes => Math.round(bytes / (1024 * 1024));

/**
 * @param {Pick<import('node:perf_hooks').PerformanceObserverEntryList, 'getEntries'>} list
 */
const logLongPauses = list => {
    for (const entry of list.getEntries()) {
        if (entry.duration < threshold) {
            continue;
        }

        // A gc entry's detail; @types/node types entries as the base PerformanceEntry
        const { kind, flags = 0 } =
            /** @type {{ detail?: { kind?: number, flags?: number } }} */ (entry).detail ?? {};
        const duration = Math.round(entry.duration);
        const { heapUsed, rss } = process.memoryUsage();

        applicationInsights.trackMetric({ name: 'GC Pause', value: duration });
        log.warn(
            {
                kind: (kind !== undefined && kinds[kind]) || kind,
                duration,
                forced: Boolean(flags & constants.NODE_PERFORMANCE_GC_FLAGS_FORCED),
                heapUsed: toMegabytes(heapUsed),
                rss: toMegabytes(rss),
            },
            'Long garbage collection pause',
        );
    }
};

/** Its observer does not hold the process open. */
const observer = new PerformanceObserver(logLongPauses);

export default {
    enable() {
        observer.observe({ type: 'gc' });
    },
    disable() {
        observer.disconnect();
    },
};
export { logLongPauses, threshold };
