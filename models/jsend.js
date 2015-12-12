/**
 * Created by chris on 9/25/15.
 */
'use strict';
var JSend = {
    error: function (message) {
        this.status = 'error';
        this.message = message;
        return this;
    },
    fail: function (data) {
        this.status = 'fail';
        this.data = data;
        return this;
    },
    success: function (data) {
        this.status = 'success';
        this.data = data;
        return this;
    }
};

module.exports = JSend;
