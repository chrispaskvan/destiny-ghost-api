/**
 * Destiny Error Class
 */
const _ = require('underscore');
/**
 * Create a new error from an error response to a Destiny web API request.
 * @class
 * @param code {string}
 * @param message {string}
 * @param status {string}
 * @constructor
 */
class DestinyError extends Error {
    constructor(code, message, status) {
        super();
        _.extend(this, {
            code: code,
            message: message,
            name: 'DestinyError',
            status: status
        });
    }
}

exports = module.exports = DestinyError;
