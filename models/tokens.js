/**
 * Created by chris on 11/7/15.
 */
var crypto = require('crypto');

var Tokens = function () {
    nconf.file("./settings/bitly.json");
    var accessToken = nconf.get("accessToken");
    var getToken = function () {
        var chars = "1234567890";
        var length = 10;
        var randomBytes = crypto.randomBytes(length);
        var result = new Array(length);
        var cursor = 0;
        for (var index = 0; index < length; index++) {
            cursor += randomBytes[i];
            result[i] = chars[cursor % 10];
        }

        return result.join('');
    };
    return {
        getToken: getToken
    }
};

module.exports = Tokens;
