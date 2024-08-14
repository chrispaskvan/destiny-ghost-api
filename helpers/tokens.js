 
/**
 * A module for creating tokens.
 *
 * @module Tokens
 * @summary Generate simple tokens.
 * @author Chris Paskvan
 * @requires crypto
 */
import { randomBytes as _randomBytes } from 'crypto';

/**
 * Returns true if the number is an integer greater than 0.
 * @param number
 * @returns {boolean}
 */
function isNormalInteger(number) {
    return Math.floor(Number(number)) > 0;
}

/**
 * Get a 16-bit Random String
 * @returns {string}
 */
function getBlob() {
    return _randomBytes(16).toString('hex');
}

/**
 * Get a Numeric Code
 * @param {number} length - The number of characters. Defaults to 6.
 * @returns {string}
 */
function getCode(length = 6) {
    const chars = '1234567890';
    let cursor = 0;

    length = isNormalInteger(length) ? length : 6;  

    const result = new Array(length);
    const randomBytes = _randomBytes(length);

    for (let index = 0; index < length; index += 1) {
        cursor += randomBytes[index];
        result[index] = chars[cursor % chars.length];
    }

    return result.join('');
}

export { getBlob, getCode };
