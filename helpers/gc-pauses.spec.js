import { constants } from 'node:perf_hooks';
import { describe, expect, it, vi } from 'vitest';
import applicationInsights from './application-insights.js';
import { logLongPauses, threshold } from './gc-pauses.js';
import log from './log.js';

vi.mock('./application-insights.js', () => ({ default: { trackMetric: vi.fn() } }));
vi.mock('./log.js', () => ({ default: { warn: vi.fn() } }));

/** @param {Array<{ duration: number, detail?: { kind: number, flags: number } }>} entries */
const listOf = entries => ({ getEntries: () => entries });

describe('logLongPauses', () => {
    it('should log a pause at or over the threshold, with its kind and the heap', () => {
        logLongPauses(
            listOf([
                {
                    duration: 1_234.56,
                    detail: { kind: constants.NODE_PERFORMANCE_GC_MAJOR, flags: 0 },
                },
            ]),
        );

        expect(log.warn).toHaveBeenCalledExactlyOnceWith(
            {
                kind: 'major',
                duration: 1_235,
                forced: false,
                heapUsed: expect.any(Number),
                rss: expect.any(Number),
            },
            'Long garbage collection pause',
        );
        expect(applicationInsights.trackMetric).toHaveBeenCalledExactlyOnceWith({
            name: 'GC Pause',
            value: 1_235,
        });
    });

    it('should leave shorter pauses unlogged', () => {
        logLongPauses(
            listOf([
                {
                    duration: threshold - 0.1,
                    detail: { kind: constants.NODE_PERFORMANCE_GC_MINOR, flags: 0 },
                },
            ]),
        );

        expect(log.warn).not.toHaveBeenCalled();
        expect(applicationInsights.trackMetric).not.toHaveBeenCalled();
    });

    it('should mark a forced collection, and pass an unknown kind through', () => {
        logLongPauses(
            listOf([
                {
                    duration: threshold,
                    detail: { kind: 64, flags: constants.NODE_PERFORMANCE_GC_FLAGS_FORCED },
                },
            ]),
        );

        expect(log.warn).toHaveBeenCalledWith(
            expect.objectContaining({ kind: 64, forced: true }),
            'Long garbage collection pause',
        );
    });
});
