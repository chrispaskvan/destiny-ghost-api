/**
 * Created by chris on 11/7/15.
 */
'use strict';
var crypto = require('crypto');

var Tokens = function () {
    var getToken = function () {
        var chars = '1234567890';
        var length = 6;
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
