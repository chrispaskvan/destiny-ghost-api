// @ts-check
/**
 * Evaluate an `If-Modified-Since` precondition (RFC 9110 §13.1.3).
 *
 * Clients echo back the `Last-Modified` value they were given, so an equal
 * date is the common case and must count as not modified. A missing or
 * unparseable date on either side means the precondition cannot be
 * evaluated, and the full response is sent.
 *
 * @param {string | undefined} ifModifiedSince - The request's `If-Modified-Since` header.
 * @param {string | undefined} lastModified - The resource's `Last-Modified` date.
 * @returns {boolean} Whether the client's copy is still current.
 */
const isNotModified = (ifModifiedSince, lastModified) => {
    // `Date`, not `Temporal`: `Temporal.Instant.from` rejects HTTP-dates (RFC 9110 §5.6.7).
    const since = Date.parse(ifModifiedSince ?? '');
    const modified = Date.parse(lastModified ?? '');

    return !Number.isNaN(since) && !Number.isNaN(modified) && modified <= since;
};

export default isNotModified;
