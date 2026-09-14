// @ts-check
import DestinyError from '../destiny/destiny.error.js';

/**
 * Represents a business-logic error when Xur inventory
 * cannot be retrieved (e.g., vendor not present in-game).
 */
class XurUnavailableError extends DestinyError {
    /**
     * @param {number} code
     * @param {string} message
     * @param {{ cause?: unknown }} [options]
     */
    constructor(code, message, options) {
        super(code, message, 'XurUnavailableError');
        this.name = 'XurUnavailableError';
        if (options?.cause) {
            this.cause = options.cause;
        }
    }
}

export default XurUnavailableError;
