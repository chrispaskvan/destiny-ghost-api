/**
 * Convert a date string to a Temporal.Instant.
 * Falls back to the Unix epoch for invalid or missing values.
 *
 * @param {string|null|undefined} dateString
 * @returns {Temporal.Instant}
 */
function toTemporalInstant(dateString) {
    const ms = new Date(dateString ?? null).getTime();

    return Temporal.Instant.fromEpochMilliseconds(Number.isNaN(ms) ? 0 : ms);
}

export default toTemporalInstant;
