/**
 * A module for creating tokens.
 *
 * @module Tokens
 * @summary Generate a simple token.
 * @author Chris Paskvan
 * @requires crypto
 */
var crypto = require('crypto');
/**
 * @constructor
 */
function Tokens() {
    'use strict';
    return;
}
/**
 * @namespace
 * @type {{getToken}}
 */
Tokens.prototype = (function () {
    'use strict';
    /**
     * Get a new token.
     * @returns {string}
     */
    var getToken = function (length) {
        length = length || 6;
        var chars = '1234567890';
        var randomBytes = crypto.randomBytes(length);
        var result = new Array(length);
        var cursor = 0;
        var index;

        for (index = 0; index < length; index += 1) {
            cursor += randomBytes[index];
            result[index] = chars[cursor % chars.length];
        }

        return result.join('');
    };
    return {
        getToken: getToken
    };
}());
module.exports = Tokens;
