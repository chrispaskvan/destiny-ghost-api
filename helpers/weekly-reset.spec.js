import { afterEach, describe, expect, it, vi } from 'vitest';
import currentWeeklyReset from './weekly-reset.js';

describe('currentWeeklyReset', () => {
    afterEach(() => {
        vi.restoreAllMocks();
    });

    it.each([
        ['just before Tuesday reset', '2026-10-06T16:59:59[UTC]', '2026-09-29'],
        ['at Tuesday reset', '2026-10-06T17:00:00[UTC]', '2026-10-06'],
        ['on Friday, when Xur arrives', '2026-10-09T17:00:00[UTC]', '2026-10-06'],
        ['on the Monday before the next reset', '2026-10-12T23:59:59[UTC]', '2026-10-06'],
        ['across a year boundary', '2027-01-01T12:00:00[UTC]', '2026-12-29'],
    ])('should name the week %s', (_label, now, expected) => {
        vi.spyOn(Temporal.Now, 'zonedDateTimeISO').mockReturnValue(
            Temporal.ZonedDateTime.from(now),
        );

        expect(currentWeeklyReset()).toBe(expected);
    });
});
