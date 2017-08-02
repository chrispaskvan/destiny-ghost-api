/**
 * A module for creating tokens.
 *
 * @module Tokens
 * @summary Generate simple tokens.
 * @author Chris Paskvan
 * @requires crypto
 */
'use strict';
var crypto = require('crypto');
/**
 * Returns true if the number is an integer greater than 0.
 * @param number
 * @returns {boolean}
 */
function isNormalInteger(number) {
    var n = Math.floor(Number(number));

    return String(n) === number && n > 0;
}
/**
 * Get a Token
 * @param length
 * @returns {string}
 */
var Tokens = {
    /**
     * Get a 16-bit Random String
     * @returns {string}
     */
    getBlob: function () {
        return crypto.randomBytes(16).toString('hex');
    },
    /**
     * Get a Numeric Code
     * @param {number} length - The number of characters. Defaults to 6.
     * @returns {string}
     */
    getCode: function (length) {
        var chars = '1234567890';
        var cursor = 0;
        var index;
        var randomBytes;
        var result;

        length = isNormalInteger(length) ? length : 6;
        result = new Array(length);
        randomBytes = crypto.randomBytes(length);
        for (index = 0; index < length; index += 1) {
            cursor += randomBytes[index];
            result[index] = chars[cursor % chars.length];
        }

        return result.join('');
    }
};

exports = module.exports = Tokens;
