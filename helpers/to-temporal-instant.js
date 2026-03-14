/**
 * Convert a date string to a Temporal.Instant.
 * Falls back to the Unix epoch for invalid or missing values.
 *
 * @param {string|null|undefined} dateString
 * @returns {Temporal.Instant}
 */
function toTemporalInstant(dateString) {
    if (!dateString) return Temporal.Instant.fromEpochMilliseconds(0);

    try {
        return Temporal.Instant.from(dateString);
    } catch {
        // Fall back to Date parsing for non-ISO formats (e.g. HTTP date headers)
        const ms = new Date(dateString).getTime();

        return Temporal.Instant.fromEpochMilliseconds(Number.isNaN(ms) ? 0 : ms);
    }
}

export default toTemporalInstant;
