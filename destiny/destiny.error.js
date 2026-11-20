// @ts-check
/**
 * Bungie error codes that mean "try again later" rather than "this request
 * is wrong". Bungie reports maintenance and throttling as HTTP 200 with the
 * code in the body, so the HTTP layer's retries never see them. Throttles
 * for features this app does not use (messaging, clans, tokens) are left out.
 * @type {Set<number>}
 */
const RETRYABLE_CODES = new Set([
    5, // SystemDisabled
    31, // ThrottleLimitExceeded
    35, // ThrottleLimitExceededMinutes
    36, // ThrottleLimitExceededMomentarily
    37, // ThrottleLimitExceededSeconds
    51, // PerEndpointRequestThrottleExceeded
    54, // PerApplicationThrottleExceeded
    55, // PerApplicationAnonymousThrottleExceeded
    56, // PerApplicationAuthenticatedThrottleExceeded
    57, // PerUserThrottleExceeded
    1672, // DestinyThrottledByGameServer
]);

/**
 * Destiny Error Class
 */
class DestinyError extends Error {
    /**
     * Create a new error from an error response to a Destiny web API request.
     *
     * @param {number} code
     * @param {string} message
     * @param {string} status
     * @param {{ cause?: unknown, retryable?: boolean }} [options] - `retryable`
     * marks a failure Bungie did not report, such as an outage, as worth
     * another attempt
     */
    constructor(code, message, status, { cause, retryable = false } = {}) {
        super(message, cause === undefined ? undefined : { cause });

        this.code = code;
        this.name = 'DestinyError';
        this.status = status;
        /**
         * Read by `isTransientError`, so a job that failed on one is retried
         * rather than given up on.
         */
        this.retryable = retryable || RETRYABLE_CODES.has(code);
    }
}

export default DestinyError;
