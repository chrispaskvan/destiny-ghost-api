import log from './log.js';

/**
 * Calculate exponential backoff delay with jitter.
 *
 * @param {number} attempt - Zero-based attempt index.
 * @param {number} [baseDelay=1000] - Base delay in milliseconds.
 * @param {number} [maxDelay=15000] - Maximum delay in milliseconds.
 * @returns {number} Delay in milliseconds.
 */
function getBackoffDelay(attempt, baseDelay = 1000, maxDelay = 15000) {
    const exponential = baseDelay * 2 ** attempt;
    const jitter = Math.random() * baseDelay;

    return Math.min(exponential + jitter, maxDelay);
}

/**
 * Retry an async function with exponential backoff.
 *
 * @param {Function} fn - Async function to retry.
 * @param {object} [options]
 * @param {number} [options.maxRetries=3]
 * @param {number} [options.baseDelay=1000]
 * @param {number} [options.maxDelay=15000]
 * @param {Function} [options.shouldRetry] - Predicate receiving the error; return false to skip retrying.
 * @returns {Promise<*>}
 */
async function withRetry(fn, { maxRetries = 3, baseDelay = 1000, maxDelay = 15000, shouldRetry } = {}) {
    let lastErr;

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
        try {
            return await fn();
        } catch (err) {
            lastErr = err;

            const canRetry = attempt < maxRetries && (!shouldRetry || shouldRetry(err));

            if (!canRetry) break;

            const delay = getBackoffDelay(attempt, baseDelay, maxDelay);

            log.warn({ attempt: attempt + 1, delay, err }, 'Retrying after transient error');

            await new Promise(resolve => setTimeout(resolve, delay));
        }
    }

    throw lastErr;
}

/**
 * HTTP-status-based transient error check.
 * Works for any SDK error that exposes a numeric `status` property
 * (Twilio RestException, Google GenAI ApiError, etc.).
 *
 * - undefined status (connection/timeout errors) → transient
 * - 408, 429, ≥500 → transient
 * - everything else → permanent
 *
 * @param {Error} err
 * @returns {boolean}
 */
function isTransientError(err) {
    const { status } = err;

    if (status === undefined) return true;

    return status === 408 || status === 429 || status >= 500;
}

/**
 * SMTP-aware transient error check for Nodemailer.
 *
 * Transient when:
 * - err.code is a connection/timeout category (ETIMEDOUT, ESOCKET, ECONNECTION, EDNS)
 * - err.responseCode is a 4xx SMTP code (421, 450, 451, 452)
 *
 * Permanent when:
 * - err.code is EAUTH, ENOAUTH, EENVELOPE (config/credential errors)
 * - err.responseCode is 5xx (550, 553, etc.)
 *
 * @param {Error} err
 * @returns {boolean}
 */
const TRANSIENT_SMTP_CODES = new Set(['ETIMEDOUT', 'ESOCKET', 'ECONNECTION', 'EDNS']);
const PERMANENT_SMTP_CODES = new Set(['EAUTH', 'ENOAUTH', 'EENVELOPE']);

function isTransientSmtpError(err) {
    if (PERMANENT_SMTP_CODES.has(err.code)) return false;
    if (TRANSIENT_SMTP_CODES.has(err.code)) return true;

    const { responseCode } = err;

    if (responseCode >= 400 && responseCode < 500) return true;

    return false;
}

export { withRetry, getBackoffDelay, isTransientError, isTransientSmtpError };
