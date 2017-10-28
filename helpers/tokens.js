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
    return Math.floor(Number(number)) > 0;
}
/**
 * Get a Token
 * @param length
 * @returns {string}
 */
class Tokens {
    /**
     * Get a 16-bit Random String
     * @returns {string}
     */
    static getBlob() {
        return crypto.randomBytes(16).toString('hex');
    }
    /**
     * Get a Numeric Code
     * @param {number} length - The number of characters. Defaults to 6.
     * @returns {string}
     */
    static getCode(length) {
        const chars = '1234567890';
        let cursor = 0;

        length = isNormalInteger(length) ? length : 6;

        let result = new Array(length);
        let randomBytes = crypto.randomBytes(length);

        for (let index = 0; index < length; index += 1) {
            cursor += randomBytes[index];
            result[index] = chars[cursor % chars.length];
        }

        return result.join('');
    }
}

module.exports = Tokens;
