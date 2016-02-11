/**
 * A module for creating tokens.
 *
 * @module Tokens
 * @summary Generate a simple token.
 * @author Chris Paskvan
 * @requires crypto
 */
/**
 * @constructor
 */
var Tokens = function () {
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
        for (var index = 0; index < length; index++) {
            cursor += randomBytes[index];
            result[index] = chars[cursor % chars.length];
        }
        return result.join('');
    };
    return {
        getToken: getToken
    };
};

module.exports = Tokens;
