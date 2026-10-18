import { describe, expect, it } from 'vitest';
import {
    callerSafe,
    PROGRESS_UNSAVED,
    recipientsNotQueued,
    SUBSCRIBERS_UNREADABLE,
    UNKNOWN,
} from './broadcast.failures.js';

describe('callerSafe', () => {
    it.each([
        ['subscribers could not be read', SUBSCRIBERS_UNREADABLE],
        ['progress could not be saved', PROGRESS_UNSAVED],
        ['recipients could not be queued', recipientsNotQueued(2, 100)],
    ])("should pass on the worker's own message when %s", (_label, reason) => {
        expect(callerSafe(reason)).toBe(reason);
    });

    it.each([
        ["BullMQ's own, after too many stalls", 'job stalled more than allowable limit'],
        ['a raw error from before the worker ran', 'Unexpected token } in JSON at position 41'],
        [
            'a raw error that only resembles a recipients message',
            '2 of 100 recipients on this page could not be queued. ECONNRESET 10.0.0.4:6380',
        ],
    ])('should replace %s', (_label, reason) => {
        expect(callerSafe(reason)).toBe(UNKNOWN);
    });

    it.each([undefined, ''])('should report nothing when nothing has failed (%j)', reason => {
        expect(callerSafe(reason)).toBeUndefined();
    });
});
