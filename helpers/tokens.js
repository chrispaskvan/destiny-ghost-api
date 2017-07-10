/**
 * A module for creating tokens.
 *
 * @module Tokens
 * @summary Generate a simple token.
 * @author Chris Paskvan
 * @requires crypto
 */
'use strict';
var crypto = require('crypto');
/**
 * Get a Token
 * @param length
 * @returns {string}
 */
var Tokens = {
    getBlob: function () {
        return crypto.randomBytes(16).toString('hex');
    },
    getCode: function (length) {
        var chars = '1234567890';
        var cursor = 0;
        var index;
        var randomBytes;
        var result;

        length = length || 6;
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
