// @ts-check
const TUESDAY = 2;

/**
 * The Destiny week the present moment belongs to, named by the date of the
 * weekly reset that started it: Tuesday, 17:00 UTC.
 *
 * Vendor events are weekly - Xur's inventory is set for the week he arrives
 * in - so this is what tells a genuinely new event from a repeat of one
 * already announced.
 * @returns {string} an ISO date, e.g. `2026-10-06`
 */
const currentWeeklyReset = () => {
    const now = Temporal.Now.zonedDateTimeISO('UTC');
    let reset = now
        .withPlainTime({ hour: 17 })
        .subtract({ days: (now.dayOfWeek - TUESDAY + 7) % 7 });

    if (Temporal.ZonedDateTime.compare(reset, now) > 0) {
        reset = reset.subtract({ weeks: 1 });
    }

    return reset.toPlainDate().toString();
};

export default currentWeeklyReset;
